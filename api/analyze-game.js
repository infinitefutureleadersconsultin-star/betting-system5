// /api/analyze-game.js
import { GameAnalyzerEngine } from "../lib/engines/gameAnalyzerEngine.js";
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

    console.log("[/api/analyze-game] body:", req.body);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const payload = {
      sport: body.sport || "",
      homeTeam: body.homeTeam || "",
      awayTeam: body.awayTeam || "",
      line: Number(body.line) || 0,
      odds: {
        home: Number(body?.odds?.home) || NaN,
        away: Number(body?.odds?.away) || NaN,
      },
      startTime: body.startTime || null,
    };

    const apiKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey });
    const engine = new GameAnalyzerEngine(sdio);

    const result = await engine.evaluateGame(payload);

    let clv = null;
    if (result?.rawNumbers?.closingOdds && result?.rawNumbers?.openingOdds) {
      clv = computeCLV(result.rawNumbers.openingOdds, result.rawNumbers.closingOdds);
    }

    const response = {
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      decision: result.recommendation,
      confidence: result.confidence,
      edge: result.edge,
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
            pick: response.decision,
            oddsAtPick: response?.rawNumbers?.openingOdds || null,
            clv,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (err) {
      console.warn("[analyze-game] analytics post failed", err?.message);
    }

    res.status(200).json(response);
  } catch (err) {
    console.error("[analyze-game] ERROR:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
