// /api/analyze-batch.js
import fetch from "node-fetch";
import { BatchAnalyzerEngine } from "../lib/engines/batchAnalyzerEngine.js";
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

// Resolve API key
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

    console.log("[/api/analyze-batch] incoming body raw:", req.body);

    let body;
    if (typeof req.body === "string") {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = {};
      }
    } else {
      body = req.body || {};
    }

    const games = Array.isArray(body.games) ? body.games : [];
    console.log("[/api/analyze-batch] parsed games count:", games.length);

    const apiKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey });
    const engine = new BatchAnalyzerEngine(sdio);

    const results = await engine.evaluateBatch(games);

    // Enrich with CLV
    const enriched = results.map((r) => {
      let clv = null;
      if (r?.rawNumbers?.closingOdds && r?.rawNumbers?.openingOdds) {
        clv = computeCLV(r.rawNumbers.openingOdds, r.rawNumbers.closingOdds);
      }
      return { ...r, clv };
    });

    // --- Post analytics for each result ---
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        await Promise.all(
          enriched.map((r) =>
            fetch(`${vercelUrl}/api/analytics`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                gameId: r.gameId || null,
                pick: r.recommendation || r.decision || null,
                oddsAtPick: r?.rawNumbers?.openingOdds || null,
                clv: r.clv || null,
                timestamp: new Date().toISOString(),
              }),
            }).catch((err) => {
              console.warn("[/api/analyze-batch] analytics post failed", err.message);
            })
          )
        );
      }
    } catch (err) {
      console.warn("[/api/analyze-batch] analytics batch failed", err.message);
    }

    console.log("[/api/analyze-batch] success:", enriched.length, "results");
    res.status(200).json({ count: enriched.length, results: enriched });
  } catch (err) {
    console.error("[/api/analyze-batch] ERROR:", err.stack || err.message);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
