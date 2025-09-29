// lib/engines/batchAnalyzerEngine.js
// Batch analyzer that handles multiple player props or game lines in one request
// Enhanced with CLV support and compatible with enhanced engines

import { PlayerPropsEngine } from "./playerPropsEngine.js";
import { GameLinesEngine } from "./gameLinesEngine.js";

export class BatchAnalyzerEngine {
  constructor(apiClient) {
    this.apiClient = apiClient || null;
  }

  /**
   * Evaluate a batch of games/props
   * Each entry should look like:
   *   { type: "prop", sport, player, opponent, prop, odds, currentPrice, startTime }
   *   { type: "game", sport, team, opponent, odds, currentPrice, startTime }
   * 
   * @param {Array} entries - Array of prop/game objects to analyze
   * @returns {Array} Results array with analysis for each entry
   */
  async evaluateBatch(entries = []) {
    if (!Array.isArray(entries)) {
      console.warn("[BatchAnalyzerEngine] entries is not an array:", typeof entries);
      return [];
    }

    const results = [];
    const startTime = Date.now();

    console.log(`[BatchAnalyzerEngine] Starting batch analysis for ${entries.length} entries`);

    for (const [i, entry] of entries.entries()) {
      const entryStartTime = Date.now();
      
      try {
        // Auto-detect type if not specified
        let entryType = entry.type;
        if (!entryType) {
          if (entry.player && entry.prop) {
            entryType = "prop";
          } else if (entry.team || entry.homeTeam) {
            entryType = "game";
          } else {
            entryType = "unknown";
          }
        }

        if (entryType === "prop") {
          // Player prop analysis
          const engine = new PlayerPropsEngine(this.apiClient);
          
          // Normalize input
          const propInput = {
            sport: String(entry.sport || "").toUpperCase(),
            player: String(entry.player || ""),
            opponent: String(entry.opponent || ""),
            prop: String(entry.prop || ""),
            startTime: entry.startTime || null,
            currentPrice: entry.currentPrice || entry.odds?.over || -110,
            odds: entry.odds || { over: -110, under: -110 }
          };

          const result = await engine.evaluateProp(propInput);
          
          const elapsed = Date.now() - entryStartTime;
          console.log(
            `[BatchAnalyzerEngine] [${i}] Prop: ${entry.player} ${entry.prop} → ${result.decision} (${result.finalConfidence}%) [${elapsed}ms]`
          );

          results.push({
            index: i,
            type: "prop",
            input: entry,
            ...result,
            meta: {
              ...(result.meta || {}),
              processingTime: elapsed
            }
          });
        } else if (entryType === "game") {
          // Game line analysis
          const engine = new GameLinesEngine(this.apiClient);
          
          // Normalize input
          const gameInput = {
            sport: String(entry.sport || "").toUpperCase(),
            team: entry.team || entry.homeTeam || "",
            opponent: entry.opponent || entry.awayTeam || "",
            startTime: entry.startTime || null,
            currentPrice: entry.currentPrice || entry.odds?.home || -110,
            odds: entry.odds || { home: -110, away: -110 }
          };

          const result = await engine.evaluateGame(gameInput);
          
          const elapsed = Date.now() - entryStartTime;
          console.log(
            `[BatchAnalyzerEngine] [${i}] Game: ${gameInput.team} vs ${gameInput.opponent} → ${result.decision} (${result.finalConfidence}%) [${elapsed}ms]`
          );

          results.push({
            index: i,
            type: "game",
            input: entry,
            ...result,
            meta: {
              ...(result.meta || {}),
              processingTime: elapsed
            }
          });
        } else {
          // Unknown type
          const elapsed = Date.now() - entryStartTime;
          console.warn(`[BatchAnalyzerEngine] [${i}] Unknown entry type:`, entryType);
          
          results.push({
            index: i,
            type: entryType || "unknown",
            input: entry,
            error: "Unsupported entry type. Must be 'prop' or 'game', or include player+prop or team fields.",
            decision: "ERROR",
            finalConfidence: 0,
            meta: {
              processingTime: elapsed
            }
          });
        }
      } catch (err) {
        const elapsed = Date.now() - entryStartTime;
        console.error(`[BatchAnalyzerEngine] [${i}] Failed:`, err?.message || err);
        
        results.push({
          index: i,
          type: entry.type || "unknown",
          input: entry,
          error: err?.message || "Unexpected error during analysis",
          decision: "ERROR",
          finalConfidence: 0,
          meta: {
            processingTime: elapsed,
            errorStack: process.env.NODE_ENV === "development" ? err?.stack : undefined
          }
        });
      }
    }

    const totalElapsed = Date.now() - startTime;
    console.log(
      `[BatchAnalyzerEngine] Batch complete: ${results.length} results in ${totalElapsed}ms (avg: ${Math.round(totalElapsed / results.length)}ms/entry)`
    );

    return results;
  }

  /**
   * Get summary statistics for a batch of results
   * @param {Array} results - Results from evaluateBatch
   * @returns {Object} Summary statistics
   */
  getSummary(results) {
    if (!Array.isArray(results)) return null;

    const summary = {
      total: results.length,
      props: 0,
      games: 0,
      errors: 0,
      locks: 0,
      strongLeans: 0,
      leans: 0,
      passes: 0,
      positiveClv: 0,
      negativeClv: 0,
      avgConfidence: 0,
      avgProcessingTime: 0,
    };

    let totalConfidence = 0;
    let totalProcessingTime = 0;

    for (const r of results) {
      if (r.type === "prop") summary.props++;
      else if (r.type === "game") summary.games++;
      
      if (r.error || r.decision === "ERROR") {
        summary.errors++;
        continue;
      }

      const decision = String(r.decision || "").toUpperCase();
      if (decision.includes("LOCK")) summary.locks++;
      else if (decision.includes("STRONG")) summary.strongLeans++;
      else if (decision.includes("LEAN")) summary.leans++;
      else if (decision.includes("PASS")) summary.passes++;

      if (r.clv) {
        if (r.clv.favorability === "favorable") summary.positiveClv++;
        else if (r.clv.favorability === "unfavorable") summary.negativeClv++;
      }

      if (Number.isFinite(r.finalConfidence)) {
        totalConfidence += r.finalConfidence;
      }

      if (r.meta?.processingTime) {
        totalProcessingTime += r.meta.processingTime;
      }
    }

    const validResults = summary.total - summary.errors;
    summary.avgConfidence = validResults > 0 ? Math.round(totalConfidence / validResults * 10) / 10 : 0;
    summary.avgProcessingTime = summary.total > 0 ? Math.round(totalProcessingTime / summary.total) : 0;

    return summary;
  }
}

export default BatchAnalyzerEngine;
