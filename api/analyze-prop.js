// /api/analyze-prop.js
import fetch from "node-fetch";
import { PlayerPropsEngine } from "../lib/engines/playerPropsEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";
import { computeCLV } from "../lib/clvTracker.js";

// --- CORS ---
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

// --- API Key resolver ---
function resolveSportsDataKey() {
  const candidates = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_API_KEY",
    "SPORTS_DATA_KEY",
  ];
  for (const name of candidates) {
    const v = process.env[name];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export default async function handler(req, res) {
  console.log("[/api/analyze-prop] START", { method: req.method });

  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // --- Parse body safely ---
    let body;
    try {
      body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};
    } catch (err) {
      console.error("[/api/analyze-prop] Body parse error:", err);
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    console.log("[/api/analyze-prop] Parsed body:", body);

    const payload = {
      sport: body.sport || "",
      player: body.player || "",
      opponent: body.opponent || "",
      prop: body.prop || "",
      odds: {
        over: Number(body?.odds?.over) || NaN,
        under: Number(body?.odds?.under) || NaN,
      },
      startTime: body.startTime || null,
    };

    const apiKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey });
    const engine = new PlayerPropsEngine(sdio);

    console.log("[/api/analyze-prop] Evaluating payload:", payload);
    const result = await engine.evaluateProp(payload);
    console.log("[/api/analyze-prop] Engine result:", result);

    let clv = null;
    if (result?.rawNumbers?.closingOdds && result?.rawNumbers?.openingOdds) {
      clv = computeCLV(result.rawNumbers.openingOdds, result.rawNumbers.closingOdds);
    }

    const response = {
      player: result.player,
      prop: result.prop,
      decision: result.decision,
      confidence: result.finalConfidence,
      suggestion: result.suggestion,
      stake: result.suggestedStake,
      topDrivers: result.topDrivers,
      flags: result.flags,
      rawNumbers: result.rawNumbers,
      clv,
      meta: result.meta,
    };

    // --- Analytics post ---
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        await fetch(`${vercelUrl}/api/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: result.gameId || null,
            propId: result.propId || null,
            pick: response.decision,
            oddsAtPick: response?.rawNumbers?.openingOdds || null,
            clv,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (err) {
      console.warn("[/api/analyze-prop] Analytics post failed:", err?.message);
    }

    res.status(200).json(response);
  } catch (err) {
    console.error("[/api/analyze-prop] ERROR:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
