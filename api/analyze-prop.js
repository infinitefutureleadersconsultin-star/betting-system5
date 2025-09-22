// /api/analyze-prop.js
import fetch from "node-fetch"; // ensure fetch exists
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

// Key resolver
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
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // --- Parse body safely ---
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        console.error("[analyze-prop] invalid JSON body", err.message);
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }
    if (typeof body !== "object" || !body) {
      console.error("[analyze-prop] body missing or invalid", body);
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

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

    console.log("[analyze-prop] payload received", payload);

    const apiKey = resolveSportsDataKey();
    if (!apiKey) {
      console.error("[analyze-prop] Missing SportsDataIO API key");
      res.status(500).json({ error: "API key not configured" });
      return;
    }

    const sdio = new SportsDataIOClient({ apiKey });
    const engine = new PlayerPropsEngine(sdio);

    const result = await engine.evaluateProp(payload);
    console.log("[analyze-prop] engine result", result);

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
      console.warn("[analyze-prop] analytics post failed", err?.message);
    }

    res.status(200).json(response);
  } catch (err) {
    console.error("[analyze-prop] fatal error", err.stack || err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
