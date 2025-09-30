// lib/engines/playerPropsEngine.js
// Enhanced with fuzzy matching, opening odds enrichment, and CLV computation
// Fixed: API timeouts, nullish coalescing, date validation, type safety, syntax errors, null checks

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

// ---------- MLB strikeout extractor (tightened) ----------
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
    
    if (str1.length === 0) return str2.length;
    if (str2.length === 0) return str1.length;
    
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  } catch (err) {
    console.warn("[_levenshteinDistance] error:", err?.message);
    return 999;
  }
}

function _tokNameMatchFactory(targetName) {
  try {
    if (!targetName) return () => false;
    const tokens = String(targetName).toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return () => false;
    
    return (candidate) => {
      try {
        if (!candidate) return false;
        const c = String(candidate).toLowerCase();
        return tokens.every((tok) => c.includes(tok));
      } catch {
        return false;
      }
    };
  } catch {
    return () => false;
  }
}

function _safeVariance(arr, minFloor = 1.4) {
  try {
    if (!Array.isArray(arr) || arr.length === 0) return minFloor;
    const nums = arr.map((x) => Number(x) || 0).filter(n => Number.isFinite(n));
    if (nums.length === 0) return minFloor;
    
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const v = nums.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / nums.length;
    return Math.max(minFloor, Number.isFinite(v) ? v : minFloor);
  } catch {
    return minFloor;
  }
}

function _uniqPush(arr, v) {
  try {
    if (Array.isArray(arr) && v !== undefined && !arr.includes(v)) {
      arr.push(v);
    }
  } catch {}
}

function _promiseWithTimeout(promise, timeoutMs, errorMsg = 'Operation timed out') {
  try {
    if (!promise || typeof promise.then !== 'function') {
      return Promise.reject(new Error('Invalid promise provided'));
    }
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
      )
    ]);
  } catch (err) {
    return Promise.reject(err);
  }
}

async function _fetchOpeningOdds(apiClient, sport, playerName, propType, gameDate) {
  try {
    if (!apiClient || !sport || !playerName || !propType) {
      return null;
    }
    
    if (apiClient && typeof apiClient.getSDIOOpeningOdds === "function") {
      try {
        const sdioOdds = await _promiseWithTimeout(
          apiClient.getSDIOOpeningOdds(sport, playerName, propType, gameDate),
          5000,
          'SDIO odds fetch timeout'
        );
        if (sdioOdds && Number.isFinite(sdioOdds.openingLine)) {
          return {
            openingLine: sdioOdds.openingLine,
            openingPrice: sdioOdds.openingPrice || -110,
            source: "SDIO",
            timestamp: sdioOdds.timestamp || new Date().toISOString()
          };
        }
      } catch (err) {
        console.warn("[_fetchOpeningOdds] SDIO fetch failed:", err?.message);
      }
    }
    
    if (apiClient && typeof apiClient.getOddsAPIOpeningOdds === "function") {
      try {
        const oddsApiData = await _promiseWithTimeout(
          apiClient.getOddsAPIOpeningOdds(sport, playerName, propType, gameDate),
          5000,
          'OddsAPI fetch timeout'
        );
        if (oddsApiData && Number.isFinite(oddsApiData.openingLine)) {
          return {
            openingLine: oddsApiData.openingLine,
            openingPrice: oddsApiData.openingPrice || -110,
            source: "OddsAPI",
            timestamp: oddsApiData.timestamp || new Date().toISOString()
          };
        }
      } catch (err) {
        console.warn("[_fetchOpeningOdds] OddsAPI fetch failed:", err?.message);
      }
    }
  } catch (err) {
    console.warn("[_fetchOpeningOdds] Opening odds fetch failed:", err?.message || err);
  }
  
  return null;
}

function _computeCLV(openingLine, currentLine, openingPrice, currentPrice) {
  try {
    if (!Number.isFinite(openingLine) || !Number.isFinite(currentLine)) {
      return { clvPercent: 0, clvDirection: "none", favorability: "neutral" };
    }
    
    const lineDiff = currentLine - openingLine;
    const lineChangePercent = openingLine !== 0 ? (lineDiff / Math.abs(openingLine)) * 100 : 0;
    
    let openingImpliedProb = 0.5;
    let currentImpliedProb = 0.5;
    
    if (Number.isFinite(openingPrice)) {
      openingImpliedProb = openingPrice < 0 
        ? Math.abs(openingPrice) / (Math.abs(openingPrice) + 100)
        : 100 / (openingPrice + 100);
    }
    
    if (Number.isFinite(currentPrice)) {
      currentImpliedProb = currentPrice < 0
        ? Math.abs(currentPrice) / (Math.abs(currentPrice) + 100)
        : 100 / (currentPrice + 100);
    }
    
    const probDiff = (currentImpliedProb - openingImpliedProb) * 100;
    const clvPercent = round2(lineChangePercent + probDiff);
    
    let clvDirection = "none";
    if (Math.abs(clvPercent) < 1) clvDirection = "none";
    else if (clvPercent > 0) clvDirection = "positive";
    else clvDirection = "negative";
    
    let favorability = "neutral";
    if (clvPercent > 3) favorability = "favorable";
    else if (clvPercent < -3) favorability = "unfavorable";
    
    return {
      clvPercent,
      clvDirection,
      favorability,
      lineDiff: round2(lineDiff),
      lineChangePercent: round2(lineChangePercent),
      openingImpliedProb: round3(openingImpliedProb),
      currentImpliedProb: round3(currentImpliedProb)
    };
  } catch (err) {
    console.warn("[_computeCLV] CLV computation failed:", err?.message || err);
    return { clvPercent: 0, clvDirection: "none", favorability: "neutral" };
  }
}

export class PlayerPropsEngine {
  constructor(apiClient) {
    this.apiClient = apiClient || null;
    this.errorFlags = [];
    this.dataSource = "fallback";
    this.usedEndpoints = [];
    this.matchedName = "";
    this.zeroFiltered = 0;
    this.recentValsCount = 0;
    this.recentSample = [];
    this.thresholds = {
      LOCK_CONFIDENCE: 0.70,
      STRONG_LEAN: 0.675,
      LEAN: 0.65,
      HOOK_BUFFER: 0.05,
      VARIANCE_PENALTY: 0.05,
      NAME_INFLATION: 0.03,
      PROJECTION_GAP_TRIGGER: 0.15,
      FUZZY_MATCH_THRESHOLD: 0.7,
    };
    this.calibrationFactor = 1.0;
  }

  validateInput(input) {
    this.errorFlags = [];
    
    if (!input || typeof input !== 'object') {
      this.errorFlags.push("MISSING_INPUT_OBJECT");
      return false;
    }
    
    const required = ["sport", "player", "prop"];
    for (const field of required) {
      if (!input[field] || String(input[field]).trim() === "") {
        this.errorFlags.push(`MISSING_${field.toUpperCase()}`);
      }
    }
    return this.errorFlags.length === 0;
  }

  extractLineFromProp(prop) {
    try {
      const m = String(prop || "").match(/(-?\d+(\.\d+)?)/);
      return m ? parseFloat(m[1]) : NaN;
    } catch {
      return NaN;
    }
  }

  calculateExponentialAverage(arr, decay) {
    try {
      if (!Array.isArray(arr) || arr.length === 0) return NaN;
      let ws = 0, tw = 0;
      for (let i = 0; i < arr.length; i++) {
        const w = Math.pow(decay, i);
        ws += (Number(arr[i]) || 0) * w;
        tw += w;
      }
      return tw > 0 ? ws / tw : NaN;
    } catch {
      return NaN;
    }
  }

  calculateVariance(arr) {
    return _safeVariance(arr, 1.4);
  }

  calculateMatchupFactor() {
    return 1.0;
  }

  calculateMinutesFactor() {
    return 1.0;
  }

  async getPlayerHistoricalStats() {
    return {
      last60: Array.from({ length: 60 }, () => 5 + Math.random() * 6),
      last30: Array.from({ length: 30 }, () => 5 + Math.random() * 6),
      last7: Array.from({ length: 7 }, () => 5 + Math.random() * 6),
      recent: Array.from({ length: 15 }, () => 5 + Math.random() * 6),
    };
  }

  async getOpponentDefensiveStats() {
    return { reboundRate: 0.5, assistRate: 0.5, strikeoutRate: 0.2 };
  }

  _pickValueFromRow(sport, prop, row) {
    try {
      if (!row || typeof row !== 'object') return NaN;
      
      const s = String(sport || "").toUpperCase();
      const p = String(prop || "").toLowerCase();

      if (s === "MLB") {
        if (p.includes("strikeout")) return _mlbStrikeoutsFromRow(row);
        return NaN;
      }
      if (s === "NBA" || s === "WNBA") {
        if (/\brebound/i.test(p)) {
          const val = row?.Rebounds ?? row?.ReboundsTotal ?? row?.REB ?? row?.REBPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        if (/\bassist/i.test(p)) {
          const val = row?.Assists ?? row?.AST ?? row?.ASTPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        if (/\b(point|pts|score)/i.test(p)) {
          const val = row?.Points ?? row?.PTS ?? row?.PTSPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        return NaN;
      }
      if (s === "NFL") {
        if (/\bpassing\b/i.test(p)) {
          const val = row?.PassingYards ?? row?.PassYds ?? row?.PassingYardsPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        if (/\brushing\b/i.test(p)) {
          const val = row?.RushingYards ?? row?.RushYds ?? row?.RushingYardsPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        if (/\b(receiving|rec)\b/i.test(p)) {
          const val = row?.ReceivingYards ?? row?.RecYds ?? row?.ReceivingYardsPerGame;
          return Number.isFinite(Number(val)) ? Number(val) : NaN;
        }
        return NaN;
      }
      return NaN;
    } catch (err) {
      console.warn("[_pickValueFromRow] error:", err?.message);
      return NaN;
    }
  }

  _pushUsed(tag) {
    try {
      if (tag && String(tag).trim()) {
        _uniqPush(this.usedEndpoints, tag);
      }
    } catch {}
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
            recentVals = await this._collectRecentByDate(input, sport, dateStr, sport === "MLB" ? 120 : 45, 10, idHint);
          }
        } catch (err) {
          console.warn("[generateFeatures] recent vals collection failed:", err?.message);
          recentVals = [];
        }

        this.recentValsCount = Array.isArray(recentVals) ? recentVals.length : 0;
        this.recentSample = Array.isArray(recentVals) ? recentVals.slice(0, 10) : [];

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
          oddsData: null,
          clv: null,
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
          oddsData: null,
          clv: null,
        };
      }

      const features = await this.generateFeatures(input);
      const line = this.extractLineFromProp(input.prop);

      let oddsData = null;
      let clvMetrics = null;
      
      try {
        let gameDate;
        try {
          const d = input?.startTime ? new Date(input.startTime) : new Date();
          if (isNaN(d.getTime())) throw new Error('Invalid date');
          gameDate = fmtLocalDate(d);
        } catch {
          gameDate = fmtLocalDate(new Date());
        }
        
        const propLower = String(input.prop || "").toLowerCase();
        const propType = propLower.includes("rebound") ? "rebounds" :
                        propLower.includes("assist") ? "assists" :
                        propLower.includes("point") ? "points" :
                        propLower.includes("strikeout") ? "strikeouts" :
                        propLower.includes("passing") ? "passing_yards" :
                        propLower.includes("rushing") ? "rushing_yards" :
                        propLower.includes("receiving") ? "receiving_yards" : "unknown";
        
        oddsData = await _fetchOpeningOdds(
          this.apiClient,
          String(input?.sport || "").toUpperCase(),
          input.player,
          propType,
          gameDate
        );
        
        if (oddsData && Number.isFinite(oddsData.openingLine)) {
          const currentPrice = input?.currentPrice || -110;
          clvMetrics = _computeCLV(
            oddsData.openingLine,
            line,
            oddsData.openingPrice,
            currentPrice
          );
          
          this._pushUsed(`odds-enrichment:${oddsData.source}`);
          
          console.log("[PlayerPropsEngine] CLV computed", {
            player: input.player,
            openingLine: oddsData.openingLine,
            currentLine: line,
            clvPercent: clvMetrics.clvPercent,
            favorability: clvMetrics.favorability
          });
        }
      } catch (err) {
        console.warn("[PlayerPropsEngine] Odds/CLV enrichment failed:", err?.message || err);
      }

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

      let modelProb = 0.5;
      if (Number.isFinite(usedAvg) && Number.isFinite(line) && (sampleSize > 0 || Number.isFinite(features.seasonAvg))) {
        const gap = usedAvg - line;
        const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
        const sizeFactor = sampleSize > 0 ? Math.min(1.5, Math.sqrt(sampleSize) / (1 + variance / 4)) : 0.6;
        modelProb = clamp01(0.5 + normalized * 0.15 * sizeFactor);
        
        if (clvMetrics && clvMetrics.favorability !== "neutral") {
          const clvAdjustment = Number.isFinite(clvMetrics.clvPercent) ? clvMetrics.clvPercent / 100 * 0.05 : 0;
          modelProb = clamp01(modelProb + clvAdjustment);
          console.log("[PlayerPropsEngine] CLV-adjusted modelProb:", {
            original: round3(modelProb - clvAdjustment),
            adjusted: round3(modelProb),
            clvAdjustment: round3(clvAdjustment)
          });
        }
      } else {
        if (Number.isFinite(usedAvg) && Number.isFinite(line)) {
          const gap = usedAvg - line;
          const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
          modelProb = clamp01(0.5 + normalized * 0.08);
        } else {
          modelProb = 0.5;
        }
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
      
      if (clvMetrics) {
        if (clvMetrics.favorability === "favorable") {
          flags.push("positive_clv");
        } else if (clvMetrics.favorability === "unfavorable") {
          flags.push("negative_clv");
        }
      }

      const suggestion = pickDecision.includes("OVER") ? "Bet Over" : pickDecision.includes("UNDER") ? "Bet Under" : "Skip";
      let suggestedStake = 0;
      if (Number.isFinite(finalConfidence) && finalConfidence >= this.thresholds.LEAN * 100) {
        suggestedStake = Math.round(((finalConfidence - 50) / 50) * 5);
        suggestedStake = Math.max(1, Math.min(5, suggestedStake));
        
        if (clvMetrics && clvMetrics.favorability === "favorable" && clvMetrics.clvPercent > 5) {
          suggestedStake = Math.min(5, suggestedStake + 1);
        }
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
      
      if (clvMetrics && oddsData) {
        topDrivers.push(`Opening line = ${round2(oddsData.openingLine)} (${oddsData.source})`);
        topDrivers.push(`CLV = ${clvMetrics.clvPercent > 0 ? '+' : ''}${round2(clvMetrics.clvPercent)}% (${clvMetrics.favorability})`);
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
        },
        oddsData: oddsData ? {
          openingLine: round2(oddsData.openingLine),
          openingPrice: oddsData.openingPrice,
          source: oddsData.source,
          timestamp: oddsData.timestamp,
        } : null,
        clv: clvMetrics ? {
          percent: round2(clvMetrics.clvPercent),
          direction: clvMetrics.clvDirection,
          favorability: clvMetrics.favorability,
          lineDiff: clvMetrics.lineDiff,
          lineChangePercent: clvMetrics.lineChangePercent,
          openingImpliedProb: clvMetrics.openingImpliedProb,
          currentImpliedProb: clvMetrics.currentImpliedProb,
        } : null,
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
        oddsData: null,
        clv: null,
      };
    }
  }
}
