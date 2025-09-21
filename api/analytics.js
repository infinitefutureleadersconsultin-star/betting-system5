// /api/analytics.js
import { computeCLV } from "../lib/clvTracker.js";
import { apiClient } from "../lib/apiClient.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { gameId, propId, pick, oddsAtPick, timestamp } = req.body || {};

    if (!gameId && !propId) {
      return res.status(400).json({ error: "Missing gameId or propId" });
    }

    // Try fetching closing odds if available
    let closingOdds = null;
    let clv = null;
    try {
      if (gameId || propId) {
        // optional helper can be added to apiClient for game/prop closing odds
        closingOdds = await apiClient.getClosingLine?.(gameId, propId);
      }
      if (closingOdds && oddsAtPick) {
        clv = computeCLV(oddsAtPick, closingOdds);
      }
    } catch (err) {
      console.warn("[analytics] CLV fetch failed", err?.message);
    }

    const logEntry = {
      gameId: gameId || null,
      propId: propId || null,
      pick: pick || null,
      oddsAtPick: oddsAtPick || null,
      closingOdds: closingOdds || null,
      clv: clv || null,
      timestamp: timestamp || new Date().toISOString(),
    };

    console.log("[analytics] log:", JSON.stringify(logEntry, null, 2));

    return res.status(200).json({ status: "ok", logEntry });
  } catch (err) {
    console.error("[analytics] fatal", err);
    return res.status(500).json({ error: "Analytics logging failed." });
  }
}
