// api/analyze-batch.js
// Batch analyzer for props + game lines with enhanced CLV and opening odds support
// Compatible with enhanced PlayerPropsEngine and GameLinesEngine

import fetch from "node-fetch";
import { PlayerPropsEngine } from "../lib/engines/playerPropsEngine.js";
import { GameLinesEngine } from "../lib/engines/gameLinesEngine.js";
import { SportsDataIOClient } from "../lib/apiClient.js";

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

function resolveSportsDataKey() {
  const names = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_API_KEY",
    "SPORTS_DATA_KEY",
  ];
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export default async function handler(req, res) {
  console.log("[/api/analyze-batch] START", { 
    method: req.method,
    timestamp: new Date().toISOString() 
  });

  if (applyCors(req, res)) return;

  try {
    // Parse body safely
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (err) {
        console.error("[BatchAnalyzer] Invalid JSON body:", err?.message || err);
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

    if (games.length === 0) {
      res.status(400).json({ error: "No games provided for analysis" });
      return;
    }

    const sdioKey = resolveSportsDataKey();
    const apiClient = new SportsDataIOClient({ apiKey: sdioKey });
    const propsEngine = new PlayerPropsEngine(apiClient);
    const gameLinesEngine = new GameLinesEngine(apiClient);

    console.log(`[BatchAnalyzer] Starting analysis for ${games.length} games`);

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const g of games) {
      console.log(
        `[BatchAnalyzer] Processing: ${g.sport} | ${g.player || g.team} vs ${g.opponent} @ ${g.startTime || "N/A"}`
      );

      try {
        // Determine if this is a player prop or game line based on input
        const isPlayerProp = g.player && g.prop;
        
        let propEval = null;
        let lineEval = null;

        // --- Player props analysis ---
        if (isPlayerProp) {
          try {
            // Construct proper input for props engine
            const propInput = {
              sport: String(g.sport || "").toUpperCase(),
              player: String(g.player || ""),
              opponent: String(g.opponent || ""),
              prop: String(g.prop || ""),
              startTime: g.startTime || null,
              currentPrice: g.currentPrice || g.odds?.over || -110,
              odds: g.odds || { over: -110, under: -110 }
            };

            propEval = await propsEngine.evaluateProp(propInput);
            
            console.log(
              `[PropsEngine] ${g.player} ${g.prop} → decision=${propEval?.decision}, conf=${propEval?.finalConfidence}%`
            );

            if (propEval?.clv) {
              console.log(
                `[PropsEngine]   CLV: ${propEval.clv.percent > 0 ? '+' : ''}${propEval.clv.percent}% (${propEval.clv.favorability})`
              );
            }

            successCount++;
          } catch (err) {
            console.warn("[PropsEngine] Error evaluating prop:", err?.message || err);
            errorCount++;
            propEval = {
              error: err?.message || "Props evaluation failed",
              decision: "ERROR",
              finalConfidence: 0
            };
          }
        }

        // --- Game lines analysis ---
        if (!isPlayerProp || g.includeGameLines) {
          try {
            lineEval = await gameLinesEngine.evaluateGame(g);
            
            console.log(
              `[GameLinesEngine] ${g.team || g.home} vs ${g.opponent || g.away} → decision=${lineEval?.decision}, conf=${lineEval?.finalConfidence}%`
            );

            if (lineEval?.meta?.matchInfo) {
              const mi = lineEval.meta.matchInfo;
              console.log(
                `[GameLinesEngine]   MatchInfo: home=${mi.home} (${mi.mlHome}), away=${mi.away} (${mi.mlAway}), book=${mi.book}`
              );
            }

            if (lineEval?.clv) {
              console.log(
                `[GameLinesEngine]   CLV: ${lineEval.clv.percent > 0 ? '+' : ''}${lineEval.clv.percent}% (${lineEval.clv.favorability})`
              );
            }

            if (!isPlayerProp) successCount++;
          } catch (err) {
            console.warn("[GameLinesEngine] Error evaluating game:", err?.message || err);
            if (!isPlayerProp) errorCount++;
            lineEval = {
              error: err?.message || "Game lines evaluation failed",
              decision: "ERROR",
              finalConfidence: 0
            };
          }
        }

        // --- Merge results ---
        results.push({
          input: g,
          props: propEval,
          lines: lineEval,
          meta: {
            analyzedAt: new Date().toISOString(),
            type: isPlayerProp ? "player_prop" : "game_line",
            dataSource: propEval?.meta?.dataSource || lineEval?.meta?.dataSource || "unknown",
            usedEndpoints: [
              ...(propEval?.meta?.usedEndpoints || []),
              ...(lineEval?.meta?.usedEndpoints || [])
            ],
            matchInfo: lineEval?.meta?.matchInfo || null,
            seasonWeek: g.sport === "NFL" ? lineEval?.meta?.seasonWeek || null : null,
          },
        });
      } catch (err) {
        console.error(`[BatchAnalyzer] Fatal error processing game:`, err?.message || err);
        errorCount++;
        results.push({
          input: g,
          props: null,
          lines: null,
          error: err?.message || "Unknown error",
          meta: {
            analyzedAt: new Date().toISOString(),
            type: "error"
          }
        });
      }
    }

    console.log(`[BatchAnalyzer] Complete: ${successCount} success, ${errorCount} errors`);

    // Optional: Post to analytics endpoint (non-blocking)
    try {
      const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
      if (vercelUrl) {
        fetch(`${vercelUrl}/api/analytics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "batch_analysis",
            gamesAnalyzed: games.length,
            successCount,
            errorCount,
            timestamp: new Date().toISOString(),
          }),
        }).catch((e) => {
          console.warn("[BatchAnalyzer] analytics post fail", e?.message);
        });
      }
    } catch (err) {
      console.warn("[BatchAnalyzer] analytics post outer failed", err?.message || err);
    }

    res.status(200).json({ 
      results,
      summary: {
        total: games.length,
        success: successCount,
        errors: errorCount,
        analyzedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[BatchAnalyzer] Fatal error:", err?.stack || err?.message);
    res.status(500).json({ 
      error: err?.message || "unknown_error",
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
    });
  }
}
