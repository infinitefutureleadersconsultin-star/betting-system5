// api/analyze-prop.js
// Enhanced for compatibility with playerPropsEngine v2 (fuzzy matching, CLV, opening odds)
import fetch from "node-fetch";
import Fuse from "fuse.js";
import { PlayerPropsEngine } from "./../lib/engines/playerPropsEngine.js";
import { SportsDataIOClient } from "./../lib/apiClient.js";
import { StatisticalModels } from "./../lib/statisticalModels.js";

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

// Roster-based fuzzy matching (pre-normalization step before engine processing)
// This helps with exact roster lookups and complements engine's fuzzy matching
function fuzzyMatchPlayerSimple(inputName, rosterList = []) {
  if (!inputName || !Array.isArray(rosterList) || rosterList.length === 0) return inputName;
  
  const candidates = rosterList
    .map((r) => ({
      name: (r?.Name || r?.FullName || r?.full_name || "").toString(),
      raw: r,
    }))
    .filter((c) => c.name);

  if (candidates.length === 0) return inputName;

  // Fuse.js fuzzy search
  const fuse = new Fuse(candidates, { keys: ["name"], threshold: 0.35 });
  const res = fuse.search(inputName);
  if (res && res.length > 0 && res[0]?.item?.name) {
    console.log(`[fuzzyMatchPlayerSimple] Matched: "${inputName}" -> "${res[0].item.name}" (score: ${res[0].score})`);
    return res[0].item.name;
  }

  // Token-based fallback
  const tok = inputName.toLowerCase().split(/\s+/).filter(Boolean);
  for (const c of candidates) {
    const cname = c.name.toLowerCase();
    const ok = tok.every((t) => cname.includes(t));
    if (ok) {
      console.log(`[fuzzyMatchPlayerSimple] Token matched: "${inputName}" -> "${c.name}"`);
      return c.name;
    }
  }
  
  return inputName;
}

// Extract American odds from payload
function extractCurrentPrice(payload) {
  try {
    // Check if odds object exists
    if (payload?.odds) {
      // Default to -110 if no valid odds
      const overOdds = Number(payload.odds.over);
      const underOdds = Number(payload.odds.under);
      
      // Return the first valid odds value found
      if (Number.isFinite(overOdds) && overOdds !== 0) return overOdds;
      if (Number.isFinite(underOdds) && underOdds !== 0) return underOdds;
    }
    
    // Check for direct price field
    if (payload?.currentPrice && Number.isFinite(Number(payload.currentPrice))) {
      return Number(payload.currentPrice);
    }
    
    // Default to standard -110 if nothing found
    return -110;
  } catch (err) {
    console.warn("[extractCurrentPrice] Failed:", err?.message || err);
    return -110;
  }
}

export default async function handler(req, res) {
  console.log("[/api/analyze-prop] START", { 
    method: req.method,
    timestamp: new Date().toISOString() 
  });

  try {
    if (applyCors(req, res)) return;
    
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // Parse request body
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch (err) {
      console.error("[/api/analyze-prop] body parse error", err?.message || err);
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    console.log("[/api/analyze-prop] body:", { body });

    // Construct payload with all necessary fields
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
      currentPrice: extractCurrentPrice(body), // NEW: for CLV computation
    };

    // Initialize API client and engine
    const sdioKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey: sdioKey });
    const engine = new PlayerPropsEngine(sdio);

    // OPTIONAL: Pre-normalize player name via roster lookup
    // This provides an exact roster match before engine's fuzzy matching
    try {
      if (["NBA", "WNBA"].includes(payload.sport) && sdio) {
        let roster = [];
        try {
          if (payload.sport === "NBA" && typeof sdio.getNBARosters === "function") {
            roster = (await sdio.getNBARosters()) || [];
          } else if (payload.sport === "WNBA" && typeof sdio.getWNBARosters === "function") {
            roster = (await sdio.getWNBARosters()) || [];
          }
        } catch (err) {
          console.warn("[/api/analyze-prop] roster fetch failed", err?.message || err);
        }
        
        if (Array.isArray(roster) && roster.length) {
          const matchedName = fuzzyMatchPlayerSimple(payload.player, roster);
          if (matchedName && matchedName !== payload.player) {
            console.log("[/api/analyze-prop] roster pre-match applied", { 
              from: payload.player, 
              to: matchedName 
            });
            payload.player = matchedName;
          }
        }
      } else if (payload.sport === "NFL" && sdio) {
        try {
          if (typeof sdio.getNFLRosters === "function") {
            const roster = (await sdio.getNFLRosters()) || [];
            if (Array.isArray(roster) && roster.length) {
              const matchedName = fuzzyMatchPlayerSimple(payload.player, roster);
              if (matchedName && matchedName !== payload.player) {
                console.log("[/api/analyze-prop] roster pre-match applied (NFL)", { 
                  from: payload.player, 
                  to: matchedName 
                });
                payload.player = matchedName;
              }
            }
          }
        } catch (err) {
          console.warn("[/api/analyze-prop] NFL roster fetch failed", err?.message || err);
        }
      }
    } catch (err) {
      console.warn("[/api/analyze-prop] roster fuzzy match failed", err?.message || err);
    }

    // Evaluate prop using enhanced engine (with built-in fuzzy matching, odds, CLV)
    console.log("[/api/analyze-prop] evaluating payload:", { payload });
    const result = await engine.evaluateProp(payload);
    console.log("[/api/analyze-prop] engine result captured", { 
      player: result?.player, 
      decision: result?.decision,
      confidence: result?.finalConfidence,
      clv: result?.clv?.percent
    });

    // Normalize result with fallback handling
    const normalizedResult = await (async function () {
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

        const raw = result.rawNumbers || {};
        const hasNumericConfidence = Number.isFinite(result.finalConfidence);
        const sampleSize = raw.sampleSize || 0;
        const seasonAvg = Number.isFinite(raw?.seasonAvg) ? raw.seasonAvg : NaN;
        const usedAvg = Number.isFinite(raw?.usedAvg) ? raw.usedAvg : NaN;

        // If engine couldn't produce a valid estimate, apply fallback baseline logic
        if ((!Number.isFinite(usedAvg) && !Number.isFinite(seasonAvg)) || 
            (hasNumericConfidence && result.finalConfidence <= 1)) {
          
          let baselineAvg = NaN;

          // Try league averages
          try {
            if (sdio && typeof sdio.getLeagueAverages === "function") {
              const la = await sdio.getLeagueAverages(payload.sport, payload.prop);
              if (la && Number.isFinite(Number(la))) baselineAvg = Number(la);
            }
          } catch (err) {
            console.warn("[/api/analyze-prop] league average fetch failed", err?.message || err);
          }

          // Try StatisticalModels baseline
          if (!Number.isFinite(baselineAvg)) {
            try {
              if (typeof StatisticalModels !== "undefined" && 
                  StatisticalModels && 
                  typeof StatisticalModels.getBaseline === "function") {
                const b = StatisticalModels.getBaseline(payload.sport, payload.prop);
                if (Number.isFinite(Number(b))) baselineAvg = Number(b);
              }
            } catch (err) {
              console.warn("[/api/analyze-prop] StatisticalModels baseline failed", err?.message || err);
            }
          }

          // Hardcoded fallback
          if (!Number.isFinite(baselineAvg)) {
            const p = (payload.prop || "").toLowerCase();
            if (p.includes("rebound")) baselineAvg = 5;
            else if (p.includes("point") || p.includes("points")) baselineAvg = 10;
            else if (p.includes("assist")) baselineAvg = 3;
            else if (p.includes("strikeout") || p.includes("strikeouts")) baselineAvg = 1.5;
            else baselineAvg = 1;
          }

          // Extract line
          const line = raw.line || (() => {
            try {
              const m = String(payload.prop || "").match(/(-?\d+(\.\d+)?)/);
              return m ? parseFloat(m[1]) : NaN;
            } catch { 
              return NaN; 
            }
          })();

          let fallbackPick = "ESTIMATE (Low Confidence)";
          let fallbackConf = 50;
          let fallbackSuggestion = "Skip or very small stake";

          if (Number.isFinite(baselineAvg) && Number.isFinite(line)) {
            fallbackPick = baselineAvg > line ? "OVER (Low Confidence)" : "UNDER (Low Confidence)";
            const diff = Math.abs(baselineAvg - line);
            fallbackConf = Math.round(50 + Math.min(40, diff * 6));
            fallbackSuggestion = fallbackPick.includes("OVER") 
              ? "Bet Over (small stake)" 
              : "Bet Under (small stake)";
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
            oddsData: result?.oddsData || null,
            clv: result?.clv || null,
            meta: result?.meta || {},
          };
        }

        // Return engine result with CLV/odds data intact
        return { 
          ...result,
          // Ensure oddsData and clv are present
          oddsData: result?.oddsData || null,
          clv: result?.clv || null,
        };
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
          oddsData: null,
          clv: null,
          meta: {},
        };
      }
    })();

    // Optional: Post to analytics endpoint (non-blocking)
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        fetch(`${vercelUrl}/api/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: result?.gameId || null,
            propId: result?.propId || null,
            pick: normalizedResult.decision,
            oddsAtPick: normalizedResult?.oddsData || null,
            clv: normalizedResult?.clv || null,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => {
          console.warn("[analyze-prop] analytics post fail", e?.message);
        });
      }
    } catch (err) {
      console.warn("[analyze-prop] analytics post outer failed", err?.message || err);
    }

    // Return final response
    res.status(200).json(normalizedResult);
  } catch (err) {
    console.error("[/api/analyze-prop] ERROR:", err?.stack || err?.message);
    res.status(500).json({ 
      error: err?.message || String(err),
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
    });
  }
}

function roundOrNull(x) {
  return Number.isFinite(Number(x)) ? Math.round(Number(x) * 1000) / 1000 : null;
}
