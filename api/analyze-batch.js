```js
// lib/engines/batchAnalyzerEngine.js
import { GameLinesEngine } from "./gameLinesEngine.js";

export class BatchAnalyzerEngine {
  constructor(sdio) {
    this.sdio = sdio;
    this.gameLinesEngine = new GameLinesEngine(sdio.apiKey);
  }

  async evaluateBatch(games = []) {
    const results = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      console.log(`[BATCH] Processing game ${i + 1}/${games.length}: ${g.team} vs ${g.opponent}`);

      try {
        const oddsResult = await this.gameLinesEngine.fetchGameOdds(g);

        if (oddsResult?.meta?.matchInfo) {
          const mi = oddsResult.meta.matchInfo;
          console.log(
            `[BATCH][MATCH_INFO] ${mi.home} (ML: ${mi.mlHome ?? "?"}) vs ${mi.away} (ML: ${mi.mlAway ?? "?"})`
          );
        } else {
          console.warn("[BATCH][MATCH_INFO] No matchInfo available for", g.team, "vs", g.opponent);
        }

        results.push({
          index: i,
          ...oddsResult
        });
      } catch (err) {
        console.error(`[BATCH] Error analyzing game ${g.team} vs ${g.opponent}:`, err.message);
        results.push({
          index: i,
          type: g.type || "game",
          error: err.message,
          clv: null
        });
      }
    }

    return results;
  }
}
```
