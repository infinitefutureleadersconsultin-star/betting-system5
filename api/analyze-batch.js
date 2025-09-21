import { BatchAnalyzerEngine } from "../lib/engines/batchAnalyzerEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";
import { computeCLV } from "../lib/clvTracker.js";

// --- Minimal CORS ---
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

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const games = Array.isArray(body.games) ? body.games : [];

    const apiKey = resolveSportsDataKey();
    const sdio = new SportsDataIOClient({ apiKey });

    console.log("[analyze-batch] running batch with", games.length, "games");

    const engine = new BatchAnalyzerEngine(sdio);
    const results = await engine.evaluateBatch(games);

    const enriched = results.map(r => {
      let clv = null;
      if (r?.rawNumbers?.closingOdds && r?.rawNumbers?.openingOdds) {
        clv = computeCLV(r.rawNumbers.openingOdds, r.rawNumbers.closingOdds);
      }
      return { ...r, clv };
    });

    // --- Analytics post for each ---
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      const analyticsUrl = `${vercelUrl}/api/analytics`;

      await Promise.all(enriched.map(r =>
        fetch(analyticsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId: r.gameId || null,
            pick: r.recommendation || r.decision || null,
            oddsAtPick: r?.rawNumbers?.openingOdds || null,
            clv: r.clv || null,
            timestamp: new Date().toISOString(),
          }),
        })
      ));
      console.log("[analyze-batch] analytics logged for", enriched.length, "entries");
    } catch (err) {
      console.warn("[analyze-batch] analytics post failed", err?.message);
    }

    res.status(200).json({ count: enriched.length, results: enriched });
  } catch (err) {
    console.error("[analyze-batch] error", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
