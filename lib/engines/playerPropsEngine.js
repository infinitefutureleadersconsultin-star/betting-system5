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
async generateFeatures(input) {
    const sport = String(input?.sport || "").toUpperCase();
    this.dataSource = "fallback";
    this.usedEndpoints = [];
    this.matchedName = "";
    this.zeroFiltered = 0;
    this.recentValsCount = 0;
    this.recentSample = [];

    let dateStr;
    try {
      const d = input?.startTime ? new Date(input.startTime) : new Date();
      const t = d.getTime();
      if (!Number.isFinite(t)) throw new Error("invalid date");
      dateStr = fmtLocalDate(d);
    } catch {
      dateStr = fmtLocalDate(new Date());
    }

    const seasonYear = new Date(dateStr).getFullYear();

    try {
      if (this.apiClient && this.apiClient.apiKey) {
        const base = new Date(dateStr);
        const datesToTry = [0, -1, -2].map((off) => {
          const d = new Date(base);
          d.setDate(d.getDate() + off);
          return fmtLocalDate(d);
        });

        const nameMatch = _tokNameMatchFactory(input.player);
        let matched = null;
        let idHint = null;

        for (const dStr of datesToTry) {
          try {
            const stats = await this._byDateArray(sport, dStr);
            if (Array.isArray(stats) && stats.length) {
              if (sport === "NBA" || sport === "WNBA" || sport === "NFL") {
                try {
                  const fuzzyMatches = stats
                    .filter(s => s && typeof s === 'object')
                    .map(s => ({
                      player: s,
                      score: _fuzzyNameMatch(
                        s?.Name || s?.PlayerName || s?.FullName,
                        input.player,
                        this.thresholds.FUZZY_MATCH_THRESHOLD
                      )
                    }))
                    .filter(m => m.score > 0)
                    .sort((a, b) => b.score - a.score);
                  
                  if (fuzzyMatches.length > 0) {
                    matched = fuzzyMatches[0].player;
                    console.log(`[PlayerPropsEngine] Initial fuzzy match: ${input.player} -> ${matched?.Name || matched?.PlayerName} (score: ${round2(fuzzyMatches[0].score)})`);
                  }
                } catch (err) {
                  console.warn("[generateFeatures] fuzzy match failed:", err?.message);
                }
              }
              
              if (!matched) {
                try {
                  matched = stats.find((s) => {
                    try {
                      return s && typeof s === 'object' && nameMatch(s?.Name || s?.PlayerName || s?.FullName);
                    } catch {
                      return false;
                    }
                  });
                } catch {}
              }
              
              if (matched) {
                this.matchedName = String(matched.Name || matched.PlayerName || matched.FullName || "");
                if (matched.PlayerID) idHint = { key: "PlayerID", value: matched.PlayerID };
                break;
              }
            }
          } catch (err) {
            console.warn(`[generateFeatures] date ${dStr} failed:`, err?.message);
          }
        }

        let seasonArr = [];
        try {
          seasonArr = (await this._seasonArray(sport, seasonYear)) || [];
        } catch (err) {
          console.warn("[PlayerPropsEngine] seasonArray fetch failed", err?.message || err);
        }
        
        let seasonAvg = NaN;
        if (Array.isArray(seasonArr) && seasonArr.length) {
          try {
            const sRow = seasonArr
              .filter(r => r && typeof r === 'object')
              .find((r) => {
                try {
                  if (r?.PlayerID && matched?.PlayerID && Number(r.PlayerID) === Number(matched.PlayerID)) return true;
                  const targetName = matched?.Name || matched?.PlayerName || matched?.FullName || input.player;
                  return _tokNameMatchFactory(targetName)(r?.Name || r?.PlayerName || r?.FullName);
                } catch {
                  return false;
                }
              });
              
            if (sRow) {
              this.matchedName = this.matchedName || String(sRow?.Name || sRow?.PlayerName || sRow?.FullName || "");
              
              if (sport === "MLB") {
                const totalK = Number(sRow?.PitchingStrikeouts ?? sRow?.Strikeouts ?? NaN);
                const starts = Number(sRow?.GamesStarted ?? NaN);
                const games = Number(sRow?.Games ?? sRow?.GamesPlayed ?? NaN);
                const denom = Number.isFinite(starts) && starts > 0 ? starts : Number.isFinite(games) && games > 0 ? games : NaN;
                if (Number.isFinite(totalK) && Number.isFinite(denom) && denom > 0) {
                  seasonAvg = totalK / denom;
                }
              } else if (sport === "NBA" || sport === "WNBA") {
                const gp = Number(sRow?.Games ?? sRow?.GamesPlayed ?? NaN);
                if (gp > 0) {
                  if (String(input.prop).toLowerCase().includes("rebound") && Number.isFinite(Number(sRow?.Rebounds))) {
                    seasonAvg = Number(sRow.Rebounds) / gp;
                  } else if (String(input.prop).toLowerCase().includes("assist") && Number.isFinite(Number(sRow?.Assists))) {
                    seasonAvg = Number(sRow.Assists) / gp;
                  } else if (String(input.prop).toLowerCase().includes("point") && Number.isFinite(Number(sRow?.Points))) {
                    seasonAvg = Number(sRow.Points) / gp;
                  }
                }
              } else if (sport === "NFL") {
                const gp = Number(sRow?.Games ?? sRow?.GamesPlayed ?? NaN);
                if (gp > 0 && String(input.prop).toLowerCase().includes("passing") && Number.isFinite(Number(sRow?.PassingYards))) {
                  seasonAvg = Number(sRow.PassingYards) / gp;
                } else if (gp > 0 && String(input.prop).toLowerCase().includes("rushing") && Number.isFinite(Number(sRow?.RushingYards))) {
                  seasonAvg = Number(sRow.RushingYards) / gp;
                } else if (gp > 0 && (String(input.prop).toLowerCase().includes("receiving") || String(input.prop).toLowerCase().includes("rec"))) {
                  if (Number.isFinite(Number(sRow?.ReceivingYards))) seasonAvg = Number(sRow.ReceivingYards) / gp;
                }
              }
            }
          } catch (err) {
            console.warn("[generateFeatures] season avg calculation failed:", err?.message);
          }
        }

        let recentVals = [];
        try {
          if (sport === "NFL") {
            const c = this.apiClient;
            let season = seasonYear;
            let curWeek = null;
            
            if (typeof c.getNFLSeasonCurrent === "function") {
              try {
                const s = await _promiseWithTimeout(
                  c.getNFLSeasonCurrent(),
                  5000,
                  'NFL season fetch timeout'
                );
                if (Number(s)) season = Number(s);
              } catch (err) {
                console.warn("[generateFeatures] NFL season fetch failed:", err?.message);
              }
            }
            
            if (typeof c.getNFLWeekCurrent === "function") {
              try {
                const w = await _promiseWithTimeout(
                  c.getNFLWeekCurrent(),
                  5000,
                  'NFL week fetch timeout'
                );
                if (Number(w)) curWeek = Number(w);
              } catch (err) {
                console.warn("[generateFeatures] NFL week fetch failed:", err?.message);
              }
            }
            
            if (!curWeek || curWeek < 1 || curWeek > 18) {
              const currentMonth = new Date().getMonth();
              if (currentMonth >= 8) {
                curWeek = Math.min(Math.floor((currentMonth - 8) * 4) + 1, 18);
              } else if (currentMonth <= 1) {
                curWeek = 18;
              } else {
                curWeek = 1;
              }
              console.warn(`[PlayerPropsEngine] NFL week fallback applied: ${curWeek}`);
            }
            
            recentVals = await this._collectNFLRecents(input, season, curWeek, 8, idHint);
          } else {
            // Use direct player game logs for MLB/NBA (more efficient, gets actual games played)
            if (sport === "MLB" && this.apiClient && typeof this.apiClient.getMLBPlayerGameLogs === "function") {
              try {
                const gameLogs = await _promiseWithTimeout(
                  this.apiClient.getMLBPlayerGameLogs(input.player, null, 15),
                  15000,
                  'MLB player game logs timeout'
                );
                
                if (Array.isArray(gameLogs) && gameLogs.length > 0) {
                  this._pushUsed(`MLB:player-game-logs:${input.player}`);
                  recentVals = gameLogs
                    .map(row => this._pickValueFromRow(sport, input.prop, row))
                    .filter(v => Number.isFinite(v) || v === 0);
                  
                  console.log(`[PlayerPropsEngine] MLB game logs: ${recentVals.length} games for ${input.player}`);
                } else {
                  recentVals = await this._collectRecentByDate(input, sport, dateStr, 15, 10, idHint);
                }
              } catch (err) {
                console.warn("[PlayerPropsEngine] MLB game logs failed:", err?.message);
                recentVals = await this._collectRecentByDate(input, sport, dateStr, 15, 10, idHint);
              }
            } else if (sport === "NBA" && this.apiClient && typeof this.apiClient.getNBAPlayerGameLogs === "function") {
              try {
                const gameLogs = await _promiseWithTimeout(
                  this.apiClient.getNBAPlayerGameLogs(input.player, seasonYear, 15),
                  15000,
                  'NBA player game logs timeout'
                );
                
                if (Array.isArray(gameLogs) && gameLogs.length > 0) {
                  this._pushUsed(`NBA:player-game-logs:${input.player}`);
                  recentVals = gameLogs
                    .map(row => this._pickValueFromRow(sport, input.prop, row))
                    .filter(v => Number.isFinite(v) || v === 0);
                  
                  console.log(`[PlayerPropsEngine] NBA game logs: ${recentVals.length} games for ${input.player}`);
                } else {
                  recentVals = await this._collectRecentByDate(input, sport, dateStr, 15, 10, idHint);
                }
              } catch (err) {
                console.warn("[PlayerPropsEngine] NBA game logs failed:", err?.message);
                recentVals = await this._collectRecentByDate(input, sport, dateStr, 15, 10, idHint);
              }
            } else {
              recentVals = await this._collectRecentByDate(input, sport, dateStr, 15, 10, idHint);
            }
          }
        } catch (err) {
          console.warn("[generateFeatures] recent vals collection failed:", err?.message);
          recentVals = [];
        }

        this.recentValsCount = Array.isArray(recentVals) ? recentVals.length : 0;
        this.recentSample = Array.isArray(recentVals) ? recentVals.slice(0, 15) : [];

        console.log("[PlayerPropsEngine] generateFeatures", {
          sport,
          player: input.player,
          matchedName: this.matchedName,
          recentFound: this.recentSample.length,
          seasonAvg: Number.isFinite(seasonAvg) ? round3(seasonAvg) : null,
          usedEndpoints: this.usedEndpoints.slice(0, 50),
        });

        return {
          sport,
          matchedName: this.matchedName,
          seasonAvg,
          recentSample: this.recentSample,
          recentValsCount: this.recentValsCount,
          usedEndpoints: this.usedEndpoints,
        };
      }
    } catch (err) {
      console.warn("[PlayerPropsEngine] generateFeatures failed", err?.message || err);
    }

    return {
      sport,
      matchedName: this.matchedName,
      seasonAvg: NaN,
      recentSample: [],
      recentValsCount: 0,
      usedEndpoints: this.usedEndpoints,
    };
  }

  async evaluateProp(input) {
    try {
      if (!input || typeof input !== 'object') {
        return {
          player: null,
          prop: null,
          decision: "ERROR",
          finalConfidence: 0,
          suggestion: "Skip - Invalid input",
          suggestedStake: 0,
          topDrivers: ["Invalid input object"],
          flags: ["INVALID_INPUT"],
          rawNumbers: {
            avgRecent: null,
            seasonAvg: null,
            usedAvg: null,
            line: null,
            sampleSize: 0,
            variance: 1.4,
            modelProb: 0.5,
          },
          meta: { usedEndpoints: [], matchedName: "" },
        };
      }

      if (!this.validateInput(input)) {
        return {
          player: input?.player || null,
          prop: input?.prop || null,
          decision: "PASS",
          finalConfidence: 49.9,
          suggestion: "Skip",
          suggestedStake: 0,
          topDrivers: [],
          flags: this.errorFlags,
          rawNumbers: {
            avgRecent: null,
            seasonAvg: null,
            usedAvg: null,
            line: this.extractLineFromProp(input?.prop),
            sampleSize: 0,
            variance: 1.4,
            modelProb: 0.5,
          },
          meta: { usedEndpoints: this.usedEndpoints, matchedName: this.matchedName },
        };
      }

      const features = await this.generateFeatures(input);
      const line = this.extractLineFromProp(input.prop);

      const avgRecent =
        Array.isArray(features.recentSample) && features.recentSample.length > 0
          ? features.recentSample.reduce((a, b) => a + b, 0) / features.recentSample.length
          : NaN;

      let usedAvg = Number.isFinite(avgRecent) ? avgRecent : Number.isFinite(features.seasonAvg) ? features.seasonAvg : NaN;

      if (!Number.isFinite(usedAvg)) {
        try {
          if (this.apiClient && typeof this.apiClient.getLeagueAverages === "function") {
            const la = await _promiseWithTimeout(
              this.apiClient.getLeagueAverages(String(input?.sport || "").toUpperCase(), input.prop),
              5000,
              'League averages timeout'
            );
            if (Number.isFinite(Number(la))) {
              usedAvg = Number(la);
              this.dataSource = "league_average";
              this._pushUsed("league:averages");
            }
          }
        } catch (err) {
          console.warn("[PlayerPropsEngine] league average fetch failed", err?.message || err);
        }
      }

      if (!Number.isFinite(usedAvg)) {
        try {
          if (typeof StatisticalModels !== "undefined" && StatisticalModels && typeof StatisticalModels.getBaseline === "function") {
            const b = StatisticalModels.getBaseline(input.sport, input.prop);
            if (Number.isFinite(Number(b))) {
              usedAvg = Number(b);
              this.dataSource = "statistical_baseline";
            }
          }
        } catch (err) {
          console.warn("[PlayerPropsEngine] StatisticalModels baseline failed", err?.message || err);
        }
      }

      if (!Number.isFinite(usedAvg)) {
        const p = String(input.prop || "").toLowerCase();
        if (p.includes("rebound")) usedAvg = 5;
        else if (p.includes("point") || p.includes("points")) usedAvg = 12;
        else if (p.includes("assist")) usedAvg = 3;
        else if (p.includes("strikeout") || p.includes("strikeouts")) usedAvg = 1.5;
        else usedAvg = 1;
        this.dataSource = "hard_default";
      }

      const sampleSize = features.recentSample.length || 0;
      const variance = this.calculateVariance(features.recentSample || []);

      // House thinking analysis
      const houseAnalysis = analyzeHouseLine(
        avgRecent, 
        features.seasonAvg, 
        line, 
        features.recentSample
      );
      
      console.log("[PlayerPropsEngine] House analysis:", {
        player: input.player,
        trapIndicators: houseAnalysis.trapIndicators,
        houseBias: houseAnalysis.houseBias,
        confidence: houseAnalysis.confidence
      });

      let modelProb = 0.5;
      if (Number.isFinite(usedAvg) && Number.isFinite(line) && (sampleSize > 0 || Number.isFinite(features.seasonAvg))) {
        const gap = usedAvg - line;
        const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
        const sizeFactor = sampleSize > 0 ? Math.min(1.5, Math.sqrt(sampleSize) / (1 + variance / 4)) : 0.6;
        modelProb = clamp01(0.5 + normalized * 0.15 * sizeFactor);
      } else {
        if (Number.isFinite(usedAvg) && Number.isFinite(line)) {
          const gap = usedAvg - line;
          const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
          modelProb = clamp01(0.5 + normalized * 0.08);
        } else {
          modelProb = 0.5;
        }
      }

      // Adjust confidence based on house trap detection
      if (houseAnalysis.trapIndicators.length > 0) {
        const trapAdjustment = houseAnalysis.houseBias * 0.04;
        modelProb = clamp01(modelProb - trapAdjustment);
        console.log(`[PlayerPropsEngine] House trap adjustment: -${round3(trapAdjustment)} (${houseAnalysis.trapIndicators.join(', ')})`);
      }

      const finalConfidence = Math.round(modelProb * 1000) / 10;

      let pickDecision = "PASS";
      if (Number.isFinite(usedAvg) && Number.isFinite(line)) {
        pickDecision = usedAvg > line ? "OVER" : "UNDER";
      } else if (Number.isFinite(line)) {
        pickDecision = "UNDER";
      } else {
        pickDecision = "PASS";
      }

      const flags = Array.isArray(this.errorFlags) ? [...this.errorFlags] : [];
      const lcThreshold = this.thresholds.LEAN * 100;
      if (!Number.isFinite(finalConfidence) || finalConfidence < lcThreshold) {
        if (!flags.includes("low_confidence")) flags.push("low_confidence");
        if (pickDecision === "OVER" || pickDecision === "UNDER") {
          pickDecision = `${pickDecision} (Low Confidence)`;
        }
      }
      
      if (houseAnalysis.trapIndicators.length > 0) {
        houseAnalysis.trapIndicators.forEach(trap => {
          if (!flags.includes(trap)) flags.push(trap);
        });
      }

      const suggestion = pickDecision.includes("OVER") ? "Bet Over" : pickDecision.includes("UNDER") ? "Bet Under" : "Skip";
      let suggestedStake = 0;
      if (Number.isFinite(finalConfidence) && finalConfidence >= this.thresholds.LEAN * 100) {
        suggestedStake = Math.round(((finalConfidence - 50) / 50) * 5);
        suggestedStake = Math.max(1, Math.min(5, suggestedStake));
      } else {
        suggestedStake = 0;
      }

      const topDrivers = [
        `Recent avg = ${Number.isFinite(avgRecent) ? round2(avgRecent) : "N/A"}`,
        `Season avg (fallback) = ${Number.isFinite(features.seasonAvg) ? round2(features.seasonAvg) : "N/A"}`,
        `Used avg = ${Number.isFinite(usedAvg) ? round2(usedAvg) : "N/A"}`,
        `Line = ${Number.isFinite(line) ? round2(line) : "N/A"}`,
        `Sample size = ${sampleSize}`,
        `Data source = ${this.dataSource}`,
      ];
      
      // Add house thinking insights
      if (houseAnalysis.trapIndicators.length > 0) {
        topDrivers.unshift(`⚠️ HOUSE TRAP DETECTED: ${houseAnalysis.trapIndicators.join(', ')}`);
        houseAnalysis.reasoning.forEach(r => topDrivers.push(`  └─ ${r}`));
      }
      
      if (Number.isFinite(line) && Number.isFinite(avgRecent)) {
        const lineDelta = ((line - avgRecent) / avgRecent * 100);
        topDrivers.push(`Line vs recent: ${lineDelta > 0 ? '+' : ''}${round2(lineDelta)}%`);
      }

      const rawNumbers = {
        avgRecent: Number.isFinite(avgRecent) ? round3(avgRecent) : null,
        seasonAvg: Number.isFinite(features.seasonAvg) ? round3(features.seasonAvg) : null,
        usedAvg: Number.isFinite(usedAvg) ? round3(usedAvg) : null,
        line,
        sampleSize,
        variance: round3(variance),
        modelProb: round3(modelProb),
      };

      return {
        player: input.player,
        prop: input.prop,
        decision: pickDecision,
        finalConfidence,
        suggestion,
        suggestedStake,
        topDrivers,
        flags,
        rawNumbers,
        meta: { 
          usedEndpoints: this.usedEndpoints, 
          matchedName: this.matchedName,
          dataSource: this.dataSource,
          zeroFiltered: this.zeroFiltered,
          houseAnalysis: {
            trapIndicators: houseAnalysis.trapIndicators,
            houseBias: houseAnalysis.houseBias,
            confidence: houseAnalysis.confidence
          }
        },
      };
} catch (err) {
      console.error("[PlayerPropsEngine] evaluateProp failed", err?.message || err, err?.stack);
      return {
        player: input?.player || null,
        prop: input?.prop || null,
        decision: "ERROR",
        finalConfidence: 0,
        suggestion: "Skip - Error occurred",
        suggestedStake: 0,
        topDrivers: ["Fatal error during evaluation"],
        flags: ["FATAL_ERROR"],
        rawNumbers: {
          avgRecent: null,
          seasonAvg: null,
          usedAvg: null,
          line: this.extractLineFromProp(input?.prop),
          sampleSize: 0,
          variance: 1.4,
          modelProb: 0.5,
        },
        meta: { 
          usedEndpoints: this.usedEndpoints, 
          matchedName: this.matchedName,
          error: err?.message || String(err)
        },
      };
    }
  }

  // Additional helper methods for future enhancements
  
  async getPlayerMatchupHistory(sport, player, opponent, season) {
    // Placeholder for future matchup-specific analysis
    // Will fetch last 10 games this player played against this specific opponent
    try {
      if (!this.apiClient) return [];
      
      // This will be implemented when we add opponent-specific analysis
      console.log(`[PlayerPropsEngine] Matchup history not yet implemented for ${player} vs ${opponent}`);
      return [];
    } catch (err) {
      console.warn("[PlayerPropsEngine] getPlayerMatchupHistory failed:", err?.message);
      return [];
    }
  }

  async getTeamTrendAnalysis(sport, team, season) {
    // Placeholder for team pace/trend analysis
    // Will help adjust player props based on team performance trends
    try {
      if (!this.apiClient) return null;
      
      console.log(`[PlayerPropsEngine] Team trend analysis not yet implemented for ${team}`);
      return null;
    } catch (err) {
      console.warn("[PlayerPropsEngine] getTeamTrendAnalysis failed:", err?.message);
      return null;
    }
  }

  async getInjuryContext(sport, player, date) {
    // Placeholder for injury report integration
    // Will flag if player is questionable/probable/returning from injury
    try {
      if (!this.apiClient) return null;
      
      console.log(`[PlayerPropsEngine] Injury context not yet implemented for ${player}`);
      return null;
    } catch (err) {
      console.warn("[PlayerPropsEngine] getInjuryContext failed:", err?.message);
      return null;
    }
  }

  calculateConfidenceAdjustments(features, houseAnalysis) {
    // Future: More sophisticated confidence adjustments
    // Will factor in: weather, venue, rest days, B2B games, etc.
    const adjustments = {
      weather: 0,
      venue: 0,
      rest: 0,
      streak: 0,
      houseTrap: houseAnalysis.houseBias * -0.04
    };
    
    return adjustments;
  }

  formatAnalysisSummary(decision, confidence, sampleSize, houseAnalysis) {
    // Create human-readable analysis summary
    let summary = `We recommend betting the ${decision} on this prop`;
    
    if (confidence >= 65) {
      summary += " with high confidence";
    } else if (confidence >= 55) {
      summary += " with moderate confidence";
    } else {
      summary += " with low confidence";
    }
    
    summary += ` (${round2(confidence)}%). `;
    
    if (houseAnalysis.trapIndicators.length > 0) {
      summary += `⚠️ WARNING: Potential Vegas trap detected (${houseAnalysis.trapIndicators.join(', ')}). `;
    }
    
    if (sampleSize < 5) {
      summary += `Our analysis is based on limited recent data (${sampleSize} games). `;
    } else {
      summary += `Our analysis is based on ${sampleSize} recent games. `;
    }
    
    return summary;
  }

  getStakingRecommendation(confidence, houseBias) {
    // Kelly Criterion-based staking
    if (confidence < 55) return { units: 0, kelly: 0, recommendation: "Skip this prop" };
    
    const edge = (confidence - 50) / 50; // 0 to 1 scale
    const kellyFraction = 0.25; // Conservative 1/4 Kelly
    
    let baseUnits = edge * 5; // Max 5 units
    
    // Reduce stake if house trap detected
    if (houseBias > 0.5) {
      baseUnits *= 0.5; // Cut stake in half for trap props
    }
    
    const units = Math.max(0.5, Math.min(5, Math.round(baseUnits * 2) / 2)); // Round to nearest 0.5
    
    return {
      units,
      kelly: kellyFraction,
      recommendation: units >= 3 ? "Strong play" : units >= 1.5 ? "Standard play" : "Light play"
    };
  }
}

// Export helper functions for testing
export {
  analyzeHouseLine,
  _fuzzyNameMatch,
  _tokNameMatchFactory,
  clamp01,
  round2,
  round3
};
