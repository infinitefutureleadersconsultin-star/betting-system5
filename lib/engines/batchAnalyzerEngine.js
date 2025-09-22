// lib/engines/batchAnalyzerEngine.js
// Batch analyzer that can handle multiple player props or game lines in one request.
// Safe, defensive, and consistent with PlayerPropsEngine + GameLinesEngine.

import { PlayerPropsEngine } from "./playerPropsEngine.js";
import { GameLinesEngine } from "./gameLinesEngine.js";

export class BatchAnalyzerEngine {
  constructor(apiClient) {
    this.apiClient = apiClient || null;
  }

  /**
   * Evaluate a batch of games/props.
   * Each entry should look like:
   *   { type: "prop", sport, player, opponent, prop, odds, startTime }
   *   { type: "game", sport, team, opponent, odds, startTime }
   */
  async evaluateBatch(entries = []) {
    if (!Array.isArray(entries)) return [];

    const results = [];

    for (const [i, entry] of entries.entries()) {
      try {
        if (entry.type === "prop") {
          const engine = new PlayerPropsEngine(this.apiClient);
          const result = await engine.evaluateProp(entry);
          results.push({ index: i, type: "prop", ...result });
        } else if (entry.type === "game") {
          const engine = new GameLinesEngine(this.apiClient);
          const result = await engine.evaluateGame(entry);
          results.push({ index: i, type: "game", ...result });
        } else {
          results.push({
            index: i,
            type: entry.type || "unknown",
            error: "Unsupported entry type",
          });
        }
      } catch (err) {
        console.error("[BatchAnalyzerEngine] failed for entry", i, err);
        results.push({
          index: i,
          type: entry.type || "unknown",
          error: err.message || "Unexpected error",
        });
      }
    }

    return results;
  }
}

export default BatchAnalyzerEngine;
