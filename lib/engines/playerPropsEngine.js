// lib/engines/playerPropsEngine.js
// Minimal / surgical fix: tighten derived K9->per-start conversion to avoid inflating per-start Ks
// for short relief outings (IP tiny).  Only accept derived per-start K when row looks like a start
// or has a multi-inning outing (IP >= 3) — otherwise ignore the derived estimate.

import { StatisticalModels } from "../statisticalModels.js";

const SMART = String(process.env.SMART_OVERLAYS || "").toUpperCase() === "ON";

function clamp01(x) { return Math.max(0, Math.min(1, Number.isFinite(Number(x)) ? Number(x) : 0)); }
function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function round3(x) { return Math.round((Number(x) || 0) * 1000) / 1000; }

function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- MLB strikeout extractor (tightened) ----------
function _mlbStrikeoutsFromRow(row) {
  const explicitFields = ["PitchingStrikeouts", "PitcherStrikeouts", "StrikeoutsPitched"];
  for (const k of explicitFields) {
    const v = Number(row?.[k]);
    if (Number.isFinite(v)) return v;
  }

  const k9Val = row?.PitchingStrikeoutsPerNine ?? row?.StrikeoutsPerNine ?? row?.KsPerNine;
  const ipVal = row?.PitchingInningsPitchedDecimal ?? row?.InningsPitchedDecimal ?? row?.InningsPitched;
  const gs = Number(row?.GamesStarted ?? row?.GS ?? 0);

  const k9 = Number(k9Val);
  const ip = Number(ipVal);

  if (Number.isFinite(k9) && Number.isFinite(ip) && ip > 0) {
    const looksLikeStart = Number.isFinite(gs) && gs > 0;
    const enoughInnings = ip >= 3.0;
    if (looksLikeStart || enoughInnings) {
      const k = (k9 * ip) / 9;
      if (Number.isFinite(k)) return k;
    }
  }
  return NaN;
}

function _tokNameMatchFactory(targetName) {
  const tokens = String(targetName || "").toLowerCase().split(/\s+/).filter(Boolean);
  return (candidate) => {
    const c = String(candidate || "").toLowerCase();
    return tokens.every(tok => c.includes(tok));
  };
}

function _safeVariance(arr, minFloor = 1.4) {
  if (!Array.isArray(arr) || arr.length === 0) return minFloor;
  const nums = arr.map(x => Number(x) || 0);
  const mean = nums.reduce((a,b)=>a+b,0)/nums.length;
  const v = nums.reduce((a,x)=>a + Math.pow(x - mean, 2), 0) / nums.length;
  return Math.max(minFloor, v);
}
function _uniqPush(arr, v) { try { if (!arr.includes(v)) arr.push(v); } catch {} }

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
    };
    this.calibrationFactor = 1.0;
  }

  validateInput(input) {
    this.errorFlags = [];
    const required = ["sport", "player", "prop"];
    for (const field of required) {
      if (!input || input[field] === undefined || input[field] === "") {
        this.errorFlags.push(`MISSING_${field.toUpperCase()}`);
      }
    }
    return this.errorFlags.length === 0;
  }

  extractLineFromProp(prop) {
    const m = String(prop || "").match(/(-?\d+(\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  calculateExponentialAverage(arr, decay) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let ws = 0, tw = 0;
    for (let i = 0; i < arr.length; i++) {
      const w = Math.pow(decay, i);
      ws += (Number(arr[i]) || 0) * w;
      tw += w;
    }
    return tw > 0 ? ws / tw : 0;
  }

  calculateVariance(arr) { return _safeVariance(arr, 1.4); }
  calculateMatchupFactor() { return 1.0; }
  calculateMinutesFactor() { return 1.0; }

  async getPlayerHistoricalStats() {
    return {
      last60: Array.from({ length: 60 }, () => 5 + Math.random() * 6),
      last30: Array.from({ length: 30 }, () => 5 + Math.random() * 6),
      last7:  Array.from({ length: 7 },  () => 5 + Math.random() * 6),
      recent: Array.from({ length: 15 }, () => 5 + Math.random() * 6),
    };
  }
  async getOpponentDefensiveStats() {
    return { reboundRate: 0.5, assistRate: 0.5, strikeoutRate: 0.2 };
  }

  _pickValueFromRow(sport, prop, row) {
    const s = String(sport || "").toUpperCase();
    const p = String(prop || "").toLowerCase();

    if (s === "MLB") {
      if (p.includes("strikeout")) return _mlbStrikeoutsFromRow(row);
      return NaN;
    }
    if (s === "NBA" || s === "WNBA") {
      if (p.includes("rebound")) return Number(row?.Rebounds) ?? Number(row?.ReboundsTotal) ?? NaN;
      if (p.includes("assist"))  return Number(row?.Assists)  ?? NaN;
      if (p.includes("point"))   return Number(row?.Points)   ?? NaN;
      return NaN;
    }
    if (s === "NFL") {
      if (p.includes("passing")) return Number(row?.PassingYards) ?? NaN;
      return NaN;
    }
    return NaN;
  }

  _pushUsed(tag) { try { _uniqPush(this.usedEndpoints, tag); } catch {} }

  async _byDateArray(sport, dateStr) {
    const c = this.apiClient;
    if (!c) return [];
    if (sport === "MLB" && typeof c.getMLBPlayerStatsByDate === "function") {
      this._pushUsed(`MLB:player-stats-by-date:${dateStr}`);
      return await c.getMLBPlayerStatsByDate(dateStr) || [];
    }
    if (sport === "NBA" && typeof c.getNBAPlayerStatsByDate === "function") {
      this._pushUsed(`NBA:player-stats-by-date:${dateStr}`);
      return await c.getNBAPlayerStatsByDate(dateStr) || [];
    }
    if (sport === "WNBA" && typeof c.getWNBAPlayerStatsByDate === "function") {
      this._pushUsed(`WNBA:player-stats-by-date:${dateStr}`);
      return await c.getWNBAPlayerStatsByDate(dateStr) || [];
    }
    return [];
  }

  async _seasonArray(sport, season) {
    const c = this.apiClient;
    if (!c) return [];
    if (sport === "MLB" && typeof c.getMLBPlayerSeasonStats === "function") {
      this._pushUsed(`MLB:player-season-stats:${season}`);
      return await c.getMLBPlayerSeasonStats(season) || [];
    }
    if (sport === "NBA" && typeof c.getNBAPlayerSeasonStats === "function") {
      this._pushUsed(`NBA:player-season-stats:${season}`);
      return await c.getNBAPlayerSeasonStats(season) || [];
    }
    if (sport === "WNBA" && typeof c.getWNBAPlayerSeasonStats === "function") {
      this._pushUsed(`WNBA:player-season-stats:${season}`);
      return await c.getWNBAPlayerSeasonStats(season) || [];
    }
    if (sport === "NFL" && typeof c.getNFLPlayerSeasonStats === "function") {
      this._pushUsed(`NFL:player-season-stats:${season}`);
      return await c.getNFLPlayerSeasonStats(season) || [];
    }
    return [];
  }

  async _collectRecentByDate(input, sport, startDateStr, lookbackDays, maxGames, idHint) {
    const nameMatch = _tokNameMatchFactory(input.player);
    const values = [];
    let date = new Date(startDateStr);
    this.zeroFiltered = 0;

    for (let d = 0; d < lookbackDays && values.length < maxGames; d++) {
      const dStr = fmtLocalDate(date);
      const arr = await this._byDateArray(sport, dStr);
      if (Array.isArray(arr) && arr.length) {
        let row = null;

        if (idHint && idHint.key && idHint.value != null) {
          row = arr.find(r => Number(r?.[idHint.key]) === Number(idHint.value));
        }
        if (!row) {
          row = arr.find(r => nameMatch(r?.Name));
        }

        if (row) {
          if (sport === "MLB") {
            const ip =
              Number(row?.PitchingInningsPitchedDecimal) ??
              Number(row?.InningsPitchedDecimal) ??
              Number(row?.InningsPitched) ?? 0;
            const outs = Number(row?.PitchingOuts) || Number(row?.OutsPitched) || 0;
            const bf  = Number(row?.PitchingBattersFaced) || Number(row?.BattersFaced) || 0;
            const gp  = Number(row?.GamesPitched) || 0;
            const gs  = Number(row?.GamesStarted) || 0;
            const pos = String(row.Position || row.PositionCategory || "").toUpperCase();
            const isPitcherLike = pos.includes("P");
            const pitched = (ip > 0) || (outs > 0) || (bf > 0) || (gp > 0) || (gs > 0) || isPitcherLike;

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
    }

    console.log("[playerPropsEngine] collected recents", { sport, player: input.player, found: values.length, filtered: this.zeroFiltered });
    return values;
  }

  async _collectNFLRecents(input, season, currentWeek, maxWeeks, idHint) {
    const values = [];
    const nameMatch = _tokNameMatchFactory(input.player);

    for (let w = currentWeek; w >= 1 && values.length < maxWeeks; w--) {
      const arr = await this._nflWeekArray(season, w);
      if (arr.length) {
        let row = null;

        if (idHint && idHint.key && idHint.value != null) {
          row = arr.find(r => Number(r?.[idHint.key]) === Number(idHint.value));
        }
        if (!row) {
          row = arr.find(r => nameMatch(r?.Name));
        }

        if (row) {
          const v = this._pickValueFromRow("NFL", input.prop, row);
          if (Number.isFinite(v)) values.push(v);
          else if (v === 0) values.push(0);
          else this.zeroFiltered++;
        }
      }
    }
    return values;
  }

  async _nflWeekArray(season, week) {
    const c = this.apiClient;
    if (!c || typeof c.getNFLPlayerGameStatsByWeek !== "function") return [];
    this._pushUsed(`NFL:player-stats-by-week:${season}-W${week}`);
    const arr = await c.getNFLPlayerGameStatsByWeek(season, week) || [];
    return Array.isArray(arr) ? arr : [];
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
        const datesToTry = [0, -1, -2].map(off => {
          const d = new Date(base);
          d.setDate(d.getDate() + off);
          return fmtLocalDate(d);
        });

        const nameMatch = _tokNameMatchFactory(input.player);
        let matched = null;
        let idHint = null;

        for (const dStr of datesToTry) {
          const stats = await this._byDateArray(sport, dStr);
          if (Array.isArray(stats) && stats.length) {
            matched = stats.find(s => nameMatch(s?.Name));
            if (matched) {
              this.matchedName = String(matched.Name || "");
              if (matched.PlayerID) idHint = { key: "PlayerID", value: matched.PlayerID };
              break;
            }
          }
        }

        let seasonArr = [];
        try { seasonArr = await this._seasonArray(sport, seasonYear) || []; } catch {}
        let seasonAvg = NaN;
        if (Array.isArray(seasonArr) && seasonArr.length) {
          const sRow = seasonArr.find(r => (r?.PlayerID && matched?.PlayerID && Number(r.PlayerID) === Number(matched.PlayerID)) || _tokNameMatchFactory(input.player)(r?.Name));
          if (sRow) {
            this.matchedName = this.matchedName || String(sRow?.Name || "");
            if (sport === "MLB") {
              const totalK  = Number(sRow?.PitchingStrikeouts ?? sRow?.Strikeouts ?? NaN);
              const starts  = Number(sRow?.GamesStarted ?? NaN);
              const games   = Number(sRow?.Games ?? sRow?.GamesPlayed ?? NaN);
              const denom = Number.isFinite(starts) && starts > 0 ? starts : (Number.isFinite(games) && games > 0 ? games : NaN);
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
              }
            }
          }
        }

        let recentVals = [];
        if (sport === "NFL") {
          const c = this.apiClient;
          let season = seasonYear;
          let curWeek = null;
          if (typeof c.getNFLSeasonCurrent === "function") {
            try { const s = await c.getNFLSeasonCurrent(); if (Number(s)) season = Number(s); } catch {}
          }
          if (typeof c.getNFLWeekCurrent === "function") {
            try { const w = await c.getNFLWeekCurrent(); if (Number(w)) curWeek = Number(w); } catch {}
          }
          if (!curWeek) curWeek = 18;
          recentVals = await this._collectNFLRecents(input, season, curWeek, 8, idHint);
        } else {
          recentVals = await this._collectRecentByDate(input, sport, dateStr, sport === "MLB" ? 120 : 45, 10, idHint);
        }

        this.recentValsCount = recentVals.length;
        this.recentSample = Array.isArray(recentVals) ? recentVals.slice(0, 10) : [];

        if (this.recentValsCount) this.dataSource = "sportsdata";
        const expAvg = recentVals.length ? this.calculateExponentialAverage(recentVals, 0.85) : NaN;

        return { seasonAvg, expAvg, recents: recentVals, recentsCount: this.recentValsCount, sample: this.recentSample };
      }
    } catch (err) {
      console.warn("[playerPropsEngine] generateFeatures error", err.message);
    }

    return { seasonAvg: NaN, expAvg: NaN, recents: [], recentsCount: 0, sample: [] };
  }

  fuseProbabilities(modelProb, marketProb, smartSignal = 0, nudges = 0) {
    const base = 0.35 * modelProb + 0.55 * marketProb + 0.10 * (0.5 + smartSignal);
    return clamp01((base + nudges) * this.calibrationFactor);
  }

  async evaluateProp(inputRaw) {
    const input = {
      sport: String(inputRaw?.sport || "NBA").toUpperCase(),
      player: inputRaw?.player || "",
      opponent: inputRaw?.opponent || "",
      prop: inputRaw?.prop || "",
      odds: {
        over: Number(inputRaw?.odds?.over) || NaN,
        under: Number(inputRaw?.odds?.under) || NaN,
      },
      startTime: inputRaw?.startTime || new Date().toISOString(),
    };

    if (!this.validateInput(input)) {
      return {
        player: input.player,
        prop: input.prop,
        decision: "PASS",
        finalConfidence: 50.0,
        suggestion: "UNDER",
        suggestedStake: 0,
        topDrivers: [],
        flags: this.errorFlags,
        rawNumbers: {},
        meta: { dataSource: "validation", note: "Invalid input" }
      };
    }

    const features = await this.generateFeatures(input);
    const line = this.extractLineFromProp(input.prop);

    const baseMean = Number.isFinite(features.expAvg) ? features.expAvg : (Number.isFinite(features.seasonAvg) ? features.seasonAvg : NaN);
    const used = Number.isFinite(baseMean) ? baseMean : 0;
    const stdev = Math.sqrt(this.calculateVariance(features.recents));

    const topDrivers = [];
    if (Number.isFinite(baseMean)) topDrivers.push(`BaseMean:${round2(baseMean)}`);
    if (Number.isFinite(stdev)) topDrivers.push(`Stdev:${round2(stdev)}`);
    if (features.recentsCount) topDrivers.push(`Recents:${features.recentsCount}`);

    let probOver = 0.5;
    if (Number.isFinite(used) && Number.isFinite(line) && Number.isFinite(stdev) && stdev > 0) {
      const z = (used - line) / stdev;
      probOver = clamp01(0.5 + 0.35 * Math.tanh(z));
    }

    const probUnder = 1 - probOver;

    const overOdds = Number(input.odds.over);
    const underOdds = Number(input.odds.under);

    function moneylineToProb(o) {
      if (!Number.isFinite(o) || o === 0) return NaN;
      if (o > 0) return 100 / (o + 100);
      return Math.abs(o) / (Math.abs(o) + 100);
    }

    const marketOverProb = moneylineToProb(overOdds);
    const marketUnderProb = moneylineToProb(underOdds);

    let fusedOver = probOver;
    let fusedUnder = probUnder;
    if (Number.isFinite(marketOverProb) && Number.isFinite(marketUnderProb)) {
      fusedOver = this.fuseProbabilities(probOver, marketOverProb, 0, 0);
      fusedUnder = this.fuseProbabilities(probUnder, marketUnderProb, 0, 0);
    }

    const confidence = fusedOver >= fusedUnder ? fusedOver : fusedUnder;
    const suggestion = fusedOver >= fusedUnder ? "OVER" : "UNDER";
    const decision =
      confidence >= this.thresholds.LOCK_CONFIDENCE ? "LOCK" :
      confidence >= this.thresholds.STRONG_LEAN ? "STRONG_LEAN" :
      confidence >= this.thresholds.LEAN ? "LEAN" : "PASS";

    const stake = confidence >= this.thresholds.LEAN ? Math.round(confidence * 10) : 0;

    const rawNumbers = {
      baseMean: round2(baseMean),
      expAvg: round2(features.expAvg),
      seasonAvg: round2(features.seasonAvg),
      stdev: round2(stdev),
      line,
      probOver: round3(probOver),
      probUnder: round3(probUnder),
      fusedOver: round3(fusedOver),
      fusedUnder: round3(fusedUnder),
      marketOverProb: round3(marketOverProb),
      marketUnderProb: round3(marketUnderProb),
      openingOdds: { over: overOdds, under: underOdds },
      closingOdds: null,
    };

    return {
      player: input.player,
      prop: input.prop,
      decision,
      finalConfidence: Math.round(confidence * 1000) / 10,
      suggestion,
      suggestedStake: stake,
      topDrivers,
      flags: this.errorFlags,
      rawNumbers,
      meta: {
        dataSource: this.dataSource,
        usedEndpoints: this.usedEndpoints,
        matchedName: this.matchedName,
        zeroFiltered: this.zeroFiltered,
        recentsCount: this.recentValsCount,
        recentsSample: this.recentSample,
      }
    };
  }
}
