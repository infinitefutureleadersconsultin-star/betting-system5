// api/analyze-prop.js
import fetch from "node-fetch";
import Fuse from "fuse.js";
import { PlayerPropsEngine } from "./../lib/engines/playerPropsEngine.js";
import { SportsDataIOClient } from "./../lib/apiClient.js";
import { computeCLV } from "./../lib/clvTracker.js";

// CORS helper
function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function resolveSportsDataKey() {
  const names = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_API_KEY",
    "SPORTS_DATA_KEY",
  ];
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

// fuzzy-match helper using roster lists (fallback)
function fuzzyMatchPlayerSimple(inputName, rosterList = []) {
  if (!inputName || !Array.isArray(rosterList) || rosterList.length === 0) return inputName;
  // rosterList expected to be array of objects with Name, full_name, or similar
  const candidates = rosterList.map((r) => {
    return {
      name: (r?.Name || r?.FullName || r?.full_name || "").toString(),
      raw: r,
    };
  }).filter((c) => c.name);
  // use fuse.js for fuzzy matching
  const fuse = new Fuse(candidates, { keys: ["name"], threshold: 0.35 });
  const res = fuse.search(inputName);
  if (res && res.length > 0 && res[0]?.item?.name) return res[0].item.name;
  // basic token match fallback
  const tok = inputName.toLowerCase().split(/\s+/).filter(Boolean);
  for (const c of candidates) {
    const cname = c.name.toLowerCase();
    const ok = tok.every((t) => cname.includes(t));
    if (ok) return c.name;
  }
  return inputName;
}

export default async function handler(req, res) {
  console.log("[/api/analyze-prop] START", { method: req.method });

  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // safe parse
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch (err) {
      console.error("[/api/analyze-prop] body parse error", err?.message || err);
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    console.log("[/api/analyze-prop] body:", { body });

    const payload = {
      sport: (body.sport || "").toUpperCase(),
      player: (body.player || "").toString(),
      opponent: body.opponent || "",
      prop: body.prop || "",
      odds: {
        over: Number(body?.odds?.over) || NaN,
        under: Number(body?.odds?.under) || NaN,
      },
      startTime: body.startTime || null,
    };

    const sdioKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey: sdioKey });
    const engine = new PlayerPropsEngine(sdio);

    // --- NEW: roster-based fuzzy matching for NBA/WNBA/NFL as available ---
    try {
      if (["NBA", "WNBA"].includes(payload.sport) && sdio && typeof sdio.getNBARosters === "function") {
        // try to gather a combined roster list
        let roster = [];
        try {
          roster = (await sdio.getNBARosters()) || [];
        } catch (err) {
          // legacy clients might expose separate WNBA roster func
          try {
            roster = (await sdio.getWNBARosters()) || [];
          } catch {}
        }
        if (!roster || roster.length === 0) {
          // try WNBA specifically
          try {
            roster = (await sdio.getWNBARosters()) || roster;
          } catch {}
        }
        if (Array.isArray(roster) && roster.length) {
          const matchedName = fuzzyMatchPlayerSimple(payload.player, roster);
          if (matchedName && matchedName !== payload.player) {
            console.log("[/api/analyze-prop] fuzzy match applied", { from: payload.player, to: matchedName });
            payload.player = matchedName;
          }
        }
      } else if (payload.sport === "NFL" && sdio && typeof sdio.getNFLRosters === "function") {
        try {
          const roster = (await sdio.getNFLRosters()) || [];
          if (Array.isArray(roster) && roster.length) {
            const matchedName = fuzzyMatchPlayerSimple(payload.player, roster);
            if (matchedName && matchedName !== payload.player) {
              console.log("[/api/analyze-prop] fuzzy match applied (NFL)", { from: payload.player, to: matchedName });
              payload.player = matchedName;
            }
          }
        } catch (err) {
          // ignore roster fetch errors
        }
      }
    } catch (err) {
      console.warn("[/api/analyze-prop] roster fuzzy match failed", err?.message || err);
    }

    console.log("[/api/analyze-prop] evaluating payload:", { payload });
    const result = await engine.evaluateProp(payload);
    console.log("[/api/analyze-prop] engine result captured", { player: result?.player, decision: result?.decision });

    // Ensure openingOdds are decimals and compute implied prob (percentage-ready decimal)
    if (result && result.rawNumbers) {
      if (!result.rawNumbers.openingOdds || Object.keys(result.rawNumbers.openingOdds).length === 0) {
        try {
          const dt = payload.startTime ? new Date(payload.startTime) : new Date();
          const dateStr = dt.toISOString().slice(0, 10);
          const s = payload.sport;
          let oddsList = null;
          if (s === "MLB" && typeof sdio.getMLBGameOdds === "function") oddsList = await sdio.getMLBGameOdds(dateStr);
          if (s === "NBA" && typeof sdio.getNBAGameOdds === "function") oddsList = await sdio.getNBAGameOdds(dateStr);
          if (s === "WNBA" && typeof sdio.getWNBAGameOdds === "function") oddsList = await sdio.getWNBAGameOdds(dateStr);
          if (s === "NFL" && typeof sdio.getNFLGameOdds === "function") oddsList = await sdio.getNFLGameOdds(dateStr);

          if (!oddsList || oddsList.length === 0) {
            // fallback to OddsAPI via SportsDataIO wrapper
            try {
              const oddsfallback = await sdio.getOddsFromOddsAPI({ sport: s, date: dateStr });
              if (oddsfallback) {
                result.rawNumbers.openingOddsFallback = oddsfallback;
              }
            } catch (err) {
              console.warn("[/api/analyze-prop] oddsfallback failed", err?.message || err);
            }
          } else {
            result.rawNumbers.openingOddsFromSDIO = oddsList;
          }
        } catch (err) {
          console.warn("[/api/analyze-prop] odds enrichment failed", err?.message || err);
        }
      }
    }

    // compute clv if we have both opening & closing
    let clv = null;
    try {
      if (result?.rawNumbers?.closingOdds && result?.rawNumbers?.openingOdds) {
        clv = computeCLV(result.rawNumbers.openingOdds, result.rawNumbers.closingOdds);
      }
    } catch (err) {
      console.warn("[/api/analyze-prop] clv compute failed", err?.message || err);
    }

    // Ensure we never return a raw NO DATA: convert conservative estimates into low-confidence picks
    const normalizedResult = (() => {
      try {
        if (!result || !result.decision) {
          return {
            ...result,
            decision: "ESTIMATE (Low Confidence)",
            finalConfidence: 50,
            suggestion: "Skip or very small stake",
            suggestedStake: 0,
            flags: [...(result?.flags || []), "no_decision_fallback"],
          };
        }

        // If engine returned NO DATA or finalConfidence 0 or sampleSize 0 and seasonAvg NaN,
        // create a fallback using league averages or StatisticalModels baseline
        const raw = result.rawNumbers || {};
        const hasNumericConfidence = Number.isFinite(result.finalConfidence);
        const sampleSize = raw.sampleSize || 0;
        const seasonAvg = Number.isFinite(raw?.seasonAvg) ? raw.seasonAvg : NaN;
        const usedAvg = Number.isFinite(raw?.usedAvg) ? raw.usedAvg : NaN;

        if ((!Number.isFinite(usedAvg) && !Number.isFinite(seasonAvg)) || (hasNumericConfidence && result.finalConfidence <= 1)) {
          // try to produce a baseline estimate here:
          let baselineAvg = NaN;
          try {
            if (sdio && typeof sdio.getLeagueAverages === "function") {
              try {
                const la = await sdio.getLeagueAverages(payload.sport, payload.prop);
                if (la && Number.isFinite(Number(la))) baselineAvg = Number(la);
              } catch (err) {
                // ignore
              }
            }
          } catch {}

          // final fallback: StatisticalModels baseline
          if (!Number.isFinite(baselineAvg)) {
            try {
              if (typeof StatisticalModels !== "undefined" && StatisticalModels && typeof StatisticalModels.getBaseline === "function") {
                const b = StatisticalModels.getBaseline(payload.sport, payload.prop);
                if (Number.isFinite(Number(b))) baselineAvg = Number(b);
              }
            } catch (err) {
              // ignore
            }
          }

          // If we still don't have baselineAvg, use a conservative default based on prop type
          if (!Number.isFinite(baselineAvg)) {
            const p = (payload.prop || "").toLowerCase();
            if (p.includes("rebound")) baselineAvg = 5; // neutral for rebounds
            else if (p.includes("point") || p.includes("points")) baselineAvg = 10; // neutral pts
            else if (p.includes("assist")) baselineAvg = 3;
            else if (p.includes("strikeout") || p.includes("strikeouts")) baselineAvg = 1.5;
            else baselineAvg = 1;
          }

          // Decide direction vs line
          const line = raw.line || (() => {
            try {
              const m = String(payload.prop || "").match(/(-?\d+(\.\d+)?)/);
              return m ? parseFloat(m[1]) : NaN;
            } catch { return NaN; }
          })();

          let fallbackPick = "ESTIMATE (Low Confidence)";
          let fallbackConf = 50;
          let fallbackSuggestion = "Skip or very small stake";

          if (Number.isFinite(baselineAvg) && Number.isFinite(line)) {
            fallbackPick = baselineAvg > line ? "OVER (Low Confidence)" : "UNDER (Low Confidence)";
            // build a conservative confidence based on difference magnitude
            const diff = Math.abs(baselineAvg - line);
            fallbackConf = Math.round(50 + Math.min(40, diff * 6)); // small diff -> ~50-60, larger diff -> up to ~90
            fallbackSuggestion = fallbackPick.includes("OVER") ? "Bet Over (small stake)" : "Bet Under (small stake)";
          }

          return {
            player: result?.player || payload.player,
            prop: result?.prop || payload.prop,
            decision: fallbackPick,
            finalConfidence: fallbackConf,
            suggestion: fallbackSuggestion,
            suggestedStake: 0,
            topDrivers: [
              `Fallback baseline used = ${roundOrNull(baselineAvg)}`,
              `Line = ${roundOrNull(line)}`,
              "No player recent/season stats available; using league/statistical baseline",
            ],
            flags: [...(result?.flags || []), "fallback_baseline"],
            rawNumbers: {
              ...raw,
              usedAvg: Number.isFinite(baselineAvg) ? roundOrNull(baselineAvg) : null,
              seasonAvg: Number.isFinite(raw?.seasonAvg) ? raw.seasonAvg : null,
              avgRecent: Number.isFinite(raw?.avgRecent) ? raw.avgRecent : null,
              line,
              sampleSize: sampleSize,
            },
            clv,
            meta: result?.meta || {},
          };
        }

        // otherwise return the engine result untouched and attach clv
        return { ...result, clv };
      } catch (err) {
        console.warn("[/api/analyze-prop] normalization failed", err?.message || err);
        return {
          player: payload.player,
          prop: payload.prop,
          decision: "ESTIMATE (Low Confidence)",
          finalConfidence: 50,
          suggestion: "Skip or very small stake",
          suggestedStake: 0,
          topDrivers: ["Normalization error fallback"],
          flags: ["normalization_error"],
          rawNumbers: { line: null, sampleSize: 0 },
          clv,
          meta: {},
        };
      }
    })();

    // analytics post (best-effort)
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        await fetch(`${vercelUrl}/api/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: result?.gameId || null,
            propId: result?.propId || null,
            pick: normalizedResult.decision,
            oddsAtPick: normalizedResult?.rawNumbers?.openingOdds || null,
            clv: normalizedResult?.clv || null,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => console.warn("[analyze-prop] analytics post fail", e?.message));
      }
    } catch (err) {
      console.warn("[analyze-prop] analytics post outer failed", err?.message || err);
    }

    res.status(200).json(normalizedResult);
  } catch (err) {
    console.error("[/api/analyze-prop] ERROR:", err?.stack || err?.message);
    res.status(500).json({ error: err?.message || String(err) });
  }
}

// small helper used in this file
function roundOrNull(x) {
  return Number.isFinite(Number(x)) ? Math.round(Number(x) * 1000) / 1000 : null;
}
