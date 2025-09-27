```js
// scripts/analyze-batch.js
// Batch analyzer that runs props + game lines with expanded logging
// Includes home/away matchInfo, data source + week tracking, and CLV computation

import fetch from "node-fetch";
import { PlayerPropsEngine } from "../lib/engines/playerPropsEngine.js";
import { GameLinesEngine } from "../lib/engines/gameLinesEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";
import { computeCLV } from "../lib/clvTracker.js";

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  try {
    // Parse body safely
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        console.error("[BatchAnalyzer] Invalid JSON body:", err);
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }
    }

    // Support both { games: [...] } and raw array
    const games = Array.isArray(body.games)
      ? body.games
      : Array.isArray(body)
      ? body
      : [];

    const apiClient = new SportsDataIOClient(process.env.SDIO_KEY);
    const propsEngine = new PlayerPropsEngine(apiClient);
    const gameLinesEngine = new GameLinesEngine(apiClient);

    console.log(`[BatchAnalyzer] Starting analysis for ${games.length} games`);

    const results = [];

    for (const g of games) {
      console.log(
        `[BatchAnalyzer] Processing: ${g.sport} | ${g.team} vs ${g.opponent} @ ${g.startTime || "N/A"}`
      );

      // --- Player props
      let propsEval = null;
      try {
        propsEval = await propsEngine.evaluatePlayer(g);
        console.log(
          `[PropsEngine] ${g.team} vs ${g.opponent} → decision=${propsEval?.decision}, conf=${propsEval?.finalConfidence}`
        );
      } catch (err) {
        console.warn("[PropsEngine] Error evaluating props:", err?.message || err);
      }

      // --- Game lines
      let linesEval = null;
      try {
        linesEval = await gameLinesEngine.evaluateGame(g);
        console.log(
          `[GameLinesEngine] ${g.team} vs ${g.opponent} → decision=${linesEval?.decision}, conf=${linesEval?.finalConfidence}`
        );
        if (linesEval?.meta?.matchInfo) {
          const mi = linesEval.meta.matchInfo;
          console.log(
            `[GameLinesEngine]   MatchInfo: home=${mi.home} (${mi.mlHome}), away=${mi.away} (${mi.mlAway}), book=${mi.book}`
          );
        }
      } catch (err) {
        console.warn("[GameLinesEngine] Error evaluating game:", err?.message || err);
      }

      // --- CLV computation
      let clv = null;
      if (linesEval?.rawNumbers?.openingOdds && linesEval?.rawNumbers?.closingOdds) {
        try {
          clv = computeCLV(
            linesEval.rawNumbers.openingOdds,
            linesEval.rawNumbers.closingOdds
          );
        } catch (err) {
          console.warn("[CLV] Failed to compute:", err?.message || err);
        }
      }

      // --- Merge results
      results.push({
        input: g,
        props: propsEval,
        lines: linesEval,
        clv,
        meta: {
          analyzedAt: new Date().toISOString(),
          dataSource: linesEval?.meta?.dataSource || "unknown",
          usedEndpoints: linesEval?.meta?.usedEndpoints || [],
          matchInfo: linesEval?.meta?.matchInfo || null,
          seasonWeek: g.sport === "NFL" ? linesEval?.meta?.seasonWeek || null : null,
        },
      });
    }

    res.status(200).json({ results });
  } catch (err) {
    console.error("[BatchAnalyzer] Fatal error:", err);
    res.status(500).json({ error: err?.message || "unknown_error" });
  }
}
```
