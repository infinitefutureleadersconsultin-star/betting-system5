// api/analyze-game.js
// Enhanced game line analyzer compatible with enhanced GameLinesEngine
import fetch from "node-fetch";
import { GameLinesEngine } from "../lib/engines/gameLinesEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";

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
    "SPORTS_DATA_KEY"
  ];
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export default async function handler(req, res) {
  console.log("[/api/analyze-game] START", { 
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
      console.error("[/api/analyze-game] body parse error", err?.message || err);
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    console.log("[/api/analyze-game] parsed body:", body);

    // Construct payload for GameLinesEngine
    const payload = {
      sport: (body.sport || "").toUpperCase(),
      team: body.team || body.homeTeam || "",
      opponent: body.opponent || body.awayTeam || "",
      startTime: body.startTime || null,
      currentPrice: body.currentPrice || body.odds?.home || body.odds?.away || -110,
      odds: {
        home: Number(body?.odds?.home) || -110,
        away: Number(body?.odds?.away) || -110,
      }
    };

    const sdioKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey: sdioKey });
    const engine = new GameLinesEngine(sdio);

    console.log("[/api/analyze-game] evaluating payload:", payload);
    const result = await engine.evaluateGame(payload);
    console.log("[/api/analyze-game] engine result captured", {
      decision: result?.decision,
      confidence: result?.finalConfidence,
      clv: result?.clv?.percent
    });

    // Normalize response structure
    const response = {
      game: `${payload.team} vs ${payload.opponent}`,
      team: payload.team,
      opponent: payload.opponent,
      decision: result.decision || result.recommendation || "PASS",
      finalConfidence: result.finalConfidence ?? result.confidence ?? 50,
      confidence: result.finalConfidence ?? result.confidence ?? 50, // Backward compat
      suggestion: result.suggestion || "Skip",
      pick: result.pick || payload.team,
      side: result.side || payload.team,
      flags: result.flags || [],
      rawNumbers: result.rawNumbers || {
        marketProbability: 0.5,
        modelProbability: 0.5,
        fusedProbability: 0.5,
      },
      oddsData: result.oddsData || null,
      clv: result.clv || null,
      meta: result.meta || {
        dataSource: "unknown",
        usedEndpoints: [],
      }
    };

    // Optional: Post to analytics endpoint (non-blocking)
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        fetch(`${vercelUrl}/api/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "game_line",
            gameId: result.gameId || null,
            pick: response.decision,
            oddsAtPick: response.oddsData || null,
            clv: response.clv || null,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => {
          console.warn("[analyze-game] analytics post fail", e?.message);
        });
      }
    } catch (err) {
      console.warn("[/api/analyze-game] analytics outer", err?.message || err);
    }

    res.status(200).json(response);
  } catch (err) {
    console.error("[/api/analyze-game] ERROR:", err?.stack || err?.message);
    res.status(500).json({ 
      error: err?.message || "Unknown error",
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
    });
  }
}
