// api/analyze-game.js
import fetch from "node-fetch";
import { GameLinesEngine } from "../lib/engines/gameLinesEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";
import { computeCLV } from "../lib/clvTracker.js";

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    res.statusCode = 204; res.end(); return true;
  }
  return false;
}

function resolveSportsDataKey() {
  const names = ["SPORTS_DATA_IO_KEY","SPORTS_DATA_IO_API_KEY","SPORTSDATAIO_KEY","SDIO_KEY","SPORTSDATA_API_KEY","SPORTS_DATA_API_KEY","SPORTS_DATA_KEY"];
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export default async function handler(req, res) {
  console.log("[/api/analyze-game] START", { method: req.method });

  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") { res.status(405).json({ error: "Method Not Allowed" }); return; }

    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}; }
    catch (err) { console.error("[/api/analyze-game] body parse error", err); res.status(400).json({ error: "Invalid JSON body" }); return; }

    console.log("[/api/analyze-game] parsed body:", body);

    const payload = {
      sport: (body.sport||"").toUpperCase(),
      homeTeam: body.homeTeam || "",
      awayTeam: body.awayTeam || "",
      line: Number(body.line) || 0,
      odds: {
        home: Number(body?.odds?.home) || NaN,
        away: Number(body?.odds?.away) || NaN,
      },
      startTime: body.startTime || null
    };

    const sdioKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey: sdioKey });
    const engine = new GameLinesEngine(sdio);

    console.log("[/api/analyze-game] evaluating payload:", payload);
    const result = await engine.evaluateGame(payload);
    console.log("[/api/analyze-game] engine result");

    let clv = null;
    if (result?.rawNumbers?.closingOdds && result?.rawNumbers?.openingOdds) {
      clv = computeCLV(result.rawNumbers.openingOdds, result.rawNumbers.closingOdds);
    }

    const response = {
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      decision: result.decision || result.recommendation,
      confidence: result.finalConfidence ?? result.confidence,
      edge: result.edge || null,
      rawNumbers: result.rawNumbers,
      clv,
      meta: result.meta
    };

    // analytics best-effort
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
        }).catch(e => console.warn("[analyze-game] analytics post fail", e?.message));
      }
    } catch (err) {
      console.warn("[/api/analyze-game] analytics outer", err?.message || err);
    }

    res.status(200).json(response);
  } catch (err) {
    console.error("[/api/analyze-game] ERROR:", err.stack || err.message);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
