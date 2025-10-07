// lib/engines/playerPropsEngine.js
// Enhanced with fuzzy matching and house-first trap detection
// PRODUCTION OPTIMIZED: Reduced lookback, using direct player game logs
// House thinking: Detects Vegas traps via recency bias, line inflation, volatility

import { StatisticalModels } from "./../statisticalModels.js";

const SMART = String(process.env.SMART_OVERLAYS || "").toUpperCase() === "ON";

function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(x)) ? Number(x) : 0));
}
function round2(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}
function round3(x) {
  return Math.round((Number(x) || 0) * 1000) / 1000;
}

function fmtLocalDate(d) {
  try {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) {
      d = new Date();
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

// ---------- MLB strikeout extractor ----------
function _mlbStrikeoutsFromRow(row) {
  if (!row || typeof row !== 'object') return NaN;
  
  const explicitFields = ["PitchingStrikeouts", "PitcherStrikeouts", "StrikeoutsPitched"];
  for (const k of explicitFields) {
    const v = Number(row?.[k]);
    if (Number.isFinite(v)) return v;
  }

  const k9Val = row?.PitchingStrikeoutsPerNine ?? row?.StrikeoutsPerNine ?? row?.KsPerNine;
  const ipVal =
    row?.PitchingInningsPitchedDecimal ?? row?.InningsPitchedDecimal ?? row?.InningsPitched;
  const gs = Number(row?.GamesStarted ?? row?.GS ?? 0);

  const k9 = Number(k9Val);
  const ip = Number(ipVal);

  if (Number.isFinite(k9) && Number.isFinite(ip) && ip > 0) {
    const looksLikeStart = Number.isFinite(gs) && gs > 0;
    const enoughInnings = ip >= 1.0;
    if (looksLikeStart || enoughInnings) {
      const k = (k9 * ip) / 9;
      if (Number.isFinite(k)) return k;
    }
  }
  return NaN;
}

// ---------- House Thinking Analysis ----------
function analyzeHouseLine(playerAvg, seasonAvg, line, recentGames) {
  const analysis = {
    houseBias: 0,
    trapIndicators: [],
    confidence: "normal",
    reasoning: []
  };
  
  const avgToUse = Number.isFinite(playerAvg) ? playerAvg : seasonAvg;
  if (!Number.isFinite(avgToUse) || !Number.isFinite(line)) {
    return analysis;
  }
  
  const delta = line - avgToUse;
  const deltaPercent = (delta / avgToUse) * 100;
  
  // 1. Detect recency bias trap (hot streak inflation)
  if (Array.isArray(recentGames) && recentGames.length >= 5) {
    const last3 = recentGames.slice(0, 3);
    const last3Avg = last3.reduce((a,b) => a+b, 0) / last3.length;
    const prior = recentGames.slice(3);
    const priorAvg = prior.length > 0 ? prior.reduce((a,b) => a+b, 0) / prior.length : avgToUse;
    
    const recentSpike = last3Avg - priorAvg;
    const spikePercent = (recentSpike / priorAvg) * 100;
    
    if (spikePercent > 25 && deltaPercent > 12) {
      analysis.trapIndicators.push("recency_bias_trap");
      analysis.houseBias += 1.2;
      analysis.confidence = "high_trap";
      analysis.reasoning.push(`Recent 3-game spike of ${round2(spikePercent)}% but line set ${round2(deltaPercent)}% above true average`);
    }
  }
  
  // 2. Line significantly inflated (public bait on over)
  if (deltaPercent > 18) {
    analysis.trapIndicators.push("inflated_line");
    analysis.houseBias += 0.8;
    analysis.reasoning.push(`Line ${round2(deltaPercent)}% above player average - likely public over trap`);
  }
  
  // 3. Line deflated (under trap)
  if (deltaPercent < -18) {
    analysis.trapIndicators.push("deflated_line");
    analysis.houseBias += 0.8;
    analysis.reasoning.push(`Line ${round2(Math.abs(deltaPercent))}% below player average - likely public under trap`);
  }
  
  // 4. Variance check (high volatility = less reliable line)
  if (Array.isArray(recentGames) && recentGames.length >= 5) {
    const mean = recentGames.reduce((a,b) => a+b, 0) / recentGames.length;
    const variance = recentGames.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentGames.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;
    
    if (cv > 0.4) {
      analysis.trapIndicators.push("high_volatility");
      analysis.reasoning.push(`High volatility (CV: ${round2(cv)}) - house expects variance to favor them`);
    }
  }
  
  return analysis;
}

// ---------- Enhanced Fuzzy Name Matching ----------
function _fuzzyNameMatch(candidate, target, threshold = 0.7) {
  try {
    if (!candidate || !target) return 0;
    const c = String(candidate).toLowerCase().trim();
    const t = String(target).toLowerCase().trim();
    
    if (!c || !t) return 0;
    if (c === t) return 1.0;
    
    const cTokens = c.split(/\s+/).filter(Boolean);
    const tTokens = t.split(/\s+/).filter(Boolean);
    
    if (cTokens.length === 0 || tTokens.length === 0) return 0;
    
    const allTokensMatch = tTokens.every(tok => c.includes(tok));
    if (allTokensMatch) return 0.95;
    
    const distance = _levenshteinDistance(c, t);
    const maxLen = Math.max(c.length, t.length);
    const similarity = maxLen > 0 ? 1 - (distance / maxLen) : 0;
    
    return similarity >= threshold ? similarity : 0;
  } catch (err) {
    console.warn("[_fuzzyNameMatch] error:", err?.message);
    return 0;
  }
}

function _levenshteinDistance(a, b) {
  try {
    if (a == null || b == null) return 999;
    const str1 = String(a).slice(0, 50);
    const str2 = String(b).slice(0, 50);
    const m = str1.length;
    const n = str2.length;
    
    if (m === 0) return n;
    if (n === 0) return m;
    
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    
    return dp[m][n];
  } catch (err) {
    console.warn("[_levenshteinDistance] error:", err?.message);
    return 999;
  }
}

function _tokNameMatchFactory(targetName) {
  try {
    const target = String(targetName || "").toLowerCase();
    const toks = target.split(/\s+/).filter(Boolean);
    if (toks.length === 0) return () => false;
    
    return (candidateName) => {
      try {
        const c = String(candidateName || "").toLowerCase();
        if (!c) return false;
        return toks.every((t) => c.includes(t));
      } catch {
        return false;
      }
    };
  } catch (err) {
    console.warn("[_tokNameMatchFactory] error:", err?.message);
    return () => false;
  }
}

function _promiseWithTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export class PlayerPropsEngine {
  constructor(apiClient, opts = {}) {
    this.apiClient = apiClient;
    this.thresholds = {
      LEAN: opts?.LEAN ?? 0.55,
      STRONG: opts?.STRONG ?? 0.65,
      HAMMER: opts?.HAMMER ?? 0.75,
      FUZZY_MATCH_THRESHOLD: opts?.FUZZY_MATCH_THRESHOLD ?? 0.7,
    };
    this.usedEndpoints = [];
    this.errorFlags = [];
    this.dataSource = "fallback";
    this.matchedName = "";
    this.zeroFiltered = 0;
    this.recentValsCount = 0;
    this.recentSample = [];
  }

  _pushUsed(endpoint) {
    if (Array.isArray(this.usedEndpoints)) {
      this.usedEndpoints.push(endpoint);
    }
  }

  validateInput(input) {
    this.errorFlags = [];
    
    if (!input || typeof input !== "object") {
      this.errorFlags.push("INVALID_INPUT");
      return false;
    }
    
    const sport = String(input?.sport || "").toUpperCase();
    if (!sport || !["NBA", "WNBA", "MLB", "NFL"].includes(sport)) {
      this.errorFlags.push("INVALID_SPORT");
    }
    
    const player = String(input?.player || "").trim();
    if (!player || player.length < 2) {
      this.errorFlags.push("INVALID_PLAYER");
    }
    
    const prop = String(input?.prop || "").trim();
    if (!prop || prop.length < 2) {
      this.errorFlags.push("INVALID_PROP");
    }
    
    return this.errorFlags.length === 0;
  }

  extractLineFromProp(propStr) {
    try {
      const s = String(propStr || "");
      const match = s.match(/(-?\d+(\.\d+)?)/);
      if (match && match[1]) {
        const val = parseFloat(match[1]);
        return Number.isFinite(val) ? val : NaN;
      }
      return NaN;
    } catch {
      return NaN;
    }
  }

  _pickValueFromRow(sport, prop, row) {
    try {
      if (!row || typeof row !== 'object') return NaN;
      
      const s = String(sport || "").toUpperCase();
      const p = String(prop || "").toLowerCase();
      
      if (s === "MLB") {
        if (p.includes("strikeout")) return _mlbStrikeoutsFromRow(row);
        if (p.includes("hit")) return Number(row?.Hits ?? row?.BattingHits ?? NaN);
        if (p.includes("run") && !p.includes("rbi")) return Number(row?.Runs ?? row?.RunsScored ?? NaN);
        if (p.includes("rbi")) return Number(row?.RunsBattedIn ?? row?.RBI ?? NaN);
        if (p.includes("homerun") || p.includes("home run")) return Number(row?.HomeRuns ?? row?.HR ?? NaN);
      }
      
      if (s === "NBA" || s === "WNBA") {
        if (p.includes("point")) return Number(row?.Points ?? row?.PTS ?? NaN);
        if (p.includes("rebound")) return Number(row?.Rebounds ?? row?.REB ?? NaN);
        if (p.includes("assist")) return Number(row?.Assists ?? row?.AST ?? NaN);
        if (p.includes("steal")) return Number(row?.Steals ?? row?.STL ?? NaN);
        if (p.includes("block")) return Number(row?.BlockedShots ?? row?.BLK ?? NaN);
        if (p.includes("three") || p.includes("3pt")) return Number(row?.ThreePointersMade ?? row?.TP3M ?? NaN);
      }
      
      if (s === "NFL") {
        if (p.includes("passing") && p.includes("yard")) return Number(row?.PassingYards ?? NaN);
        if (p.includes("rushing") && p.includes("yard")) return Number(row?.RushingYards ?? NaN);
        if (p.includes("receiving") && p.includes("yard")) return Number(row?.ReceivingYards ?? NaN);
        if (p.includes("reception")) return Number(row?.Receptions ?? NaN);
        if (p.includes("touchdown") || p.includes("td")) {
          const pass = Number(row?.PassingTouchdowns ?? 0);
          const rush = Number(row?.RushingTouchdowns ?? 0);
          const rec = Number(row?.ReceivingTouchdowns ?? 0);
          const total = pass + rush + rec;
          return Number.isFinite(total) ? total : NaN;
        }
      }
      
      return NaN;
    } catch (err) {
      console.warn("[_pickValueFromRow] error:", err?.message);
      return NaN;
    }
  }

  calculateVariance(values) {
    try {
      if (!Array.isArray(values) || values.length === 0) return 1.4;
      
      const validVals = values.filter(v => Number.isFinite(v));
      if (validVals.length === 0) return 1.4;
      if (validVals.length === 1) return 0.8;
      
      const mean = validVals.reduce((a, b) => a + b, 0) / validVals.length;
      const variance = validVals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / validVals.length;
      
      return Number.isFinite(variance) ? variance : 1.4;
    } catch {
      return 1.4;
    }
  }

  async _byDateArray(sport, dateStr) {
    const c = this.apiClient;
    if (!c) return [];
    
    try {
      if (sport === "MLB" && typeof c.getMLBPlayerStatsByDate === "function") {
        this._pushUsed(`MLB:player-stats-by-date:${dateStr}`);
        const result = await _promiseWithTimeout(
          c.getMLBPlayerStatsByDate(dateStr),
          10000,
          'MLB stats fetch timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "NBA" && typeof c.getNBAPlayerStatsByDate === "function") {
        this._pushUsed(`NBA:player-stats-by-date:${dateStr}`);
        const result = await _promiseWithTimeout(
          c.getNBAPlayerStatsByDate(dateStr),
          10000,
          'NBA stats fetch timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "WNBA" && typeof c.getWNBAPlayerStatsByDate === "function") {
        this._pushUsed(`WNBA:player-stats-by-date:${dateStr}`);
        const result = await _promiseWithTimeout(
          c.getWNBAPlayerStatsByDate(dateStr),
          10000,
          'WNBA stats fetch timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "NFL" && typeof c.getNFLPlayerStatsByDate === "function") {
        this._pushUsed(`NFL:player-stats-by-date:${dateStr}`);
        const result = await _promiseWithTimeout(
          c.getNFLPlayerStatsByDate(dateStr),
          10000,
          'NFL stats fetch timeout'
        );
        return Array.isArray(result) ? result : [];
      }
    } catch (err) {
      console.warn("[PlayerPropsEngine] _byDateArray failed", err?.message || err);
    }
    return [];
  }

  async _seasonArray(sport, season) {
    const c = this.apiClient;
    if (!c) return [];
    
    try {
      if (sport === "MLB" && typeof c.getMLBPlayerSeasonStats === "function") {
        this._pushUsed(`MLB:player-season-stats:${season}`);
        const result = await _promiseWithTimeout(
          c.getMLBPlayerSeasonStats(season),
          10000,
          'MLB season stats timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "NBA" && typeof c.getNBAPlayerSeasonStats === "function") {
        this._pushUsed(`NBA:player-season-stats:${season}`);
        const result = await _promiseWithTimeout(
          c.getNBAPlayerSeasonStats(season),
          10000,
          'NBA season stats timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "WNBA" && typeof c.getWNBAPlayerSeasonStats === "function") {
        this._pushUsed(`WNBA:player-season-stats:${season}`);
        const result = await _promiseWithTimeout(
          c.getWNBAPlayerSeasonStats(season),
          10000,
          'WNBA season stats timeout'
        );
        return Array.isArray(result) ? result : [];
      }
      if (sport === "NFL" && typeof c.getNFLPlayerSeasonStats === "function") {
        this._pushUsed(`NFL:player-season-stats:${season}`);
        const result = await _promiseWithTimeout(
          c.getNFLPlayerSeasonStats(season),
          10000,
          'NFL season stats timeout'
        );
        return Array.isArray(result) ? result : [];
      }
    } catch (err) {
      console.warn("[PlayerPropsEngine] _seasonArray failed", err?.message || err);
    }
    return [];
  }

  async _collectRecentByDate(input, sport, startDateStr, lookbackDays, maxGames, idHint) {
    const nameMatch = _tokNameMatchFactory(input.player);
    const values = [];
    
    let date;
    try {
      date = new Date(startDateStr);
      if (isNaN(date.getTime())) {
        date = new Date();
      }
    } catch {
      date = new Date();
    }
    
    this.zeroFiltered = 0;

    for (let d = 0; d < lookbackDays && values.length < maxGames; d++) {
      try {
        const dStr = fmtLocalDate(date);
        const arr = await this._byDateArray(sport, dStr);
        
        if (Array.isArray(arr) && arr.length) {
          let row = null;

          if (idHint && typeof idHint === 'object' && idHint.key && idHint.value != null) {
            try {
              row = arr.find((r) => r && typeof r === 'object' && Number(r?.[idHint.key]) === Number(idHint.value));
            } catch {}
          }
          
          if (!row && (sport === "NBA" || sport === "WNBA" || sport === "NFL")) {
            try {
              const fuzzyMatches = arr
                .filter(r => r && typeof r === 'object')
                .map(r => ({
                  row: r,
                  score: _fuzzyNameMatch(
                    r?.Name || r?.FullName || r?.PlayerName,
                    input.player,
                    this.thresholds.FUZZY_MATCH_THRESHOLD
                  )
                }))
                .filter(m => m.score > 0)
                .sort((a, b) => b.score - a.score);
              
              if (fuzzyMatches.length > 0) {
                row = fuzzyMatches[0].row;
                
                if (fuzzyMatches.length > 1 && fuzzyMatches[0].score - fuzzyMatches[1].score < 0.05) {
                  console.warn(`[PlayerPropsEngine] Ambiguous fuzzy match for ${input.player}: ${fuzzyMatches[0].row?.Name || fuzzyMatches[0].row?.PlayerName} (${round2(fuzzyMatches[0].score)}) vs ${fuzzyMatches[1].row?.Name || fuzzyMatches[1].row?.PlayerName} (${round2(fuzzyMatches[1].score)})`);
                } else {
                  console.log(`[PlayerPropsEngine] Fuzzy matched: ${input.player} -> ${row?.Name || row?.PlayerName} (score: ${round2(fuzzyMatches[0].score)})`);
                }
              }
            } catch (err) {
              console.warn("[_collectRecentByDate] fuzzy match failed:", err?.message);
            }
          }
          
          if (!row) {
            try {
              row = arr.find((r) => {
                try {
                  return r && typeof r === 'object' && nameMatch(r?.Name || r?.FullName || r?.PlayerName);
                } catch {
                  return false;
                }
              });
            } catch {}
          }

          if (row) {
            if (sport === "MLB") {
              const ip =
                Number(row?.PitchingInningsPitchedDecimal) ??
                Number(row?.InningsPitchedDecimal) ??
                Number(row?.InningsPitched) ??
                0;
              const outs = Number(row?.PitchingOuts) || Number(row?.OutsPitched) || 0;
              const bf = Number(row?.PitchingBattersFaced) || Number(row?.BattersFaced) || 0;
              const gp = Number(row?.GamesPitched) || 0;
              const gs = Number(row?.GamesStarted) || 0;
              const pos = String(row.Position || row.PositionCategory || "").toUpperCase();
              const isPitcherLike = pos.includes("P");
              const pitched = ip > 0 || outs > 0 || bf > 0 || gp > 0 || gs > 0 || isPitcherLike;

              if (!pitched) {
                this.zeroFiltered++;
              } else {
                const v = this._pickValueFromRow(sport, input.prop, row);
                if (Number.isFinite(v)) values.push(v);
                else if (v === 0) values.push(0);
                else this.zeroFiltered++;
              }
            } else {
              const v = this._pickValueFromRow(sport, input.prop, row);
              if (Number.isFinite(v)) values.push(v);
              else if (v === 0) values.push(0);
              else this.zeroFiltered++;
            }
          }
        }
        date.setDate(date.getDate() - 1);
      } catch (err) {
        console.warn(`[_collectRecentByDate] loop iteration failed for day ${d}:`, err?.message);
        date.setDate(date.getDate() - 1);
      }
    }

    console.log("[PlayerPropsEngine] collected recents", {
      sport,
      player: input.player,
      found: values.length,
      filtered: this.zeroFiltered,
    });
    return values;
  }

  async _collectNFLRecents(input, season, currentWeek, maxWeeks, idHint) {
    const values = [];
    const nameMatch = _tokNameMatchFactory(input.player);

    for (let w = currentWeek; w >= 1 && values.length < maxWeeks; w--) {
      try {
        const arr = await this._nflWeekArray(season, w);
        if (Array.isArray(arr) && arr.length) {
          let row = null;

          if (idHint && typeof idHint === 'object' && idHint.key && idHint.value != null) {
            try {
              row = arr.find((r) => r && typeof r === 'object' && Number(r?.[idHint.key]) === Number(idHint.value));
            } catch {}
          }
          
          if (!row) {
            try {
              const fuzzyMatches = arr
                .filter(r => r && typeof r === 'object')
                .map(r => ({
                  row: r,
                  score: _fuzzyNameMatch(
                    r?.Name || r?.PlayerName || r?.FullName,
                    input.player,
                    this.thresholds.FUZZY_MATCH_THRESHOLD
                  )
                }))
                .filter(m => m.score > 0)
                .sort((a, b) => b.score - a.score);
              
              if (fuzzyMatches.length > 0) {
                row = fuzzyMatches[0].row;
                
                if (fuzzyMatches.length > 1 && fuzzyMatches[0].score - fuzzyMatches[1].score < 0.05) {
                  console.warn(`[PlayerPropsEngine] NFL Ambiguous match for ${input.player}: ${fuzzyMatches[0].row?.Name || fuzzyMatches[0].row?.PlayerName} (${round2(fuzzyMatches[0].score)}) vs ${fuzzyMatches[1].row?.Name || fuzzyMatches[1].row?.PlayerName} (${round2(fuzzyMatches[1].score)})`);
                } else {
                  console.log(`[PlayerPropsEngine] NFL Fuzzy matched: ${input.player} -> ${row?.Name || row?.PlayerName} (score: ${round2(fuzzyMatches[0].score)})`);
                }
              }
            } catch (err) {
              console.warn("[_collectNFLRecents] fuzzy match failed:", err?.message);
            }
          }
          
          if (!row) {
            try {
              row = arr.find((r) => r && typeof r === 'object' && nameMatch(r?.Name || r?.PlayerName || r?.FullName));
            } catch {}
          }

          if (row) {
            const v = this._pickValueFromRow("NFL", input.prop, row);
            if (Number.isFinite(v)) values.push(v);
            else if (v === 0) values.push(0);
            else this.zeroFiltered++;
          }
        }
      } catch (err) {
        console.warn(`[_collectNFLRecents] week ${w} failed:`, err?.message);
      }
    }
    return values;
  }

  async _nflWeekArray(season, week) {
    const c = this.apiClient;
    if (!c || typeof c.getNFLPlayerGameStatsByWeek !== "function") return [];
    
    try {
      this._pushUsed(`NFL:player-stats-by-week:${season}-W${week}`);
      const result = await _promiseWithTimeout(
        c.getNFLPlayerGameStatsByWeek(season, week),
        10000,
        'NFL week stats timeout'
      );
      const arr = Array.isArray(result) ? result : [];
      return arr;
    } catch (err) {
      console.warn("[PlayerPropsEngine] _nflWeekArray failed", err?.message || err);
      return [];
    }
  }
