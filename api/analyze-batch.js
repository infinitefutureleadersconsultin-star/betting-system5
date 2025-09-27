```js
// scripts/analyze-batch.js
// Batch analyzer that runs props + game lines with expanded logging
// Includes home/away matchInfo and data source + week tracking

import fetch from "node-fetch";
import { PlayerPropsEngine } from "../lib/engines/playerPropsEngine.js";
import { GameLinesEngine } from "../lib/engines/gameLinesEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";
import { computeCLV } from "../lib/clvTracker.js";

function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const body = req.body || {};
    const games = Array.isArray(body.games) ? body.games : [];
    const apiClient = new SportsDataIOClient(process.env.SDIO_KEY);
    const propsEngine = new PlayerPropsEngine(apiClient);
    const gameLinesEngine = new GameLinesEngine(apiClient);

    console.log(
      `[BatchAnalyzer] Starting analysis for ${games.length} games`
    );

    const results = [];

    for (const g of games) {
      console.log(
        `\n[BatchAnalyzer] Processing: ${g.sport} | ${g.team} vs ${g.opponent} @ ${g.startTime}`
      );

      // --- Player props
      let propsEval = null;
      try {
        propsEval = await propsEngine.evaluatePlayer(g);
        console.log(
          `[PropsEngine] ${g.team} vs ${g.opponent} → decision=${propsEval?.decision}, conf=${propsEval?.finalConfidence}`
        );
      } catch (err) {
        console.warn(
          "[PropsEngine] Error evaluating props:",
          err?.message || err
        );
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
            `   MatchInfo: home=${mi.home} (${mi.mlHome}), away=${mi.away} (${mi.mlAway}), book=${mi.book}`
          );
        }
      } catch (err) {
        console.warn(
          "[GameLinesEngine] Error evaluating game:",
          err?.message || err
        );
      }

      // --- Merge results
      results.push({
        input: g,
        props: propsEval,
        lines: linesEval,
        meta: {
          analyzedAt: new Date().toISOString(),
          dataSource: linesEval?.meta?.dataSource || "unknown",
          usedEndpoints: linesEval?.meta?.usedEndpoints || [],
          matchInfo: linesEval?.meta?.matchInfo || null,
          seasonWeek: g.sport === "NFL"
            ? linesEval?.meta?.seasonWeek || null
            : null,
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
