// lib/engines/playerPropsEngine.js
// Minimal / surgical fix: mirror MLB robustness across NBA/WNBA/NFL with fallback layers,
// variance floor, improved name matching, and consistent compile-safe logging.

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
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
  const ipVal =
    row?.PitchingInningsPitchedDecimal ?? row?.InningsPitchedDecimal ?? row?.InningsPitched;
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

// ---------- Improved Name Matching ----------
function _tokNameMatchFactory(targetName) {
  const tokens = String(targetName || "").toLowerCase().split(/\s+/).filter(Boolean);
  return (candidate) => {
    try {
      const c = String(candidate || "").toLowerCase();
      return tokens.every((tok) => c.includes(tok));
    } catch {
      return false;
    }
  };
}

// ---------- Variance floor ----------
function _safeVariance(arr, minFloor = 1.4) {
  if (!Array.isArray(arr) || arr.length === 0) return minFloor;
  const nums = arr.map((x) => Number(x) || 0);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, x) => a + Math.pow(x - mean, 2), 0) / nums.length;
  return Math.max(minFloor, Number.isFinite(v) ? v : minFloor);
}

function _uniqPush(arr, v) {
  try {
    if (!arr.includes(v)) arr.push(v);
  } catch {}
}

// ---------- PlayerPropsEngine ----------
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
    return m ? parseFloat(m[1]) : NaN;
  }

  calculateExponentialAverage(arr, decay) {
    if (!Array.isArray(arr) || arr.length === 0) return NaN;
    let ws = 0,
      tw = 0;
    for (let i = 0; i < arr.length; i++) {
      const w = Math.pow(decay, i);
      ws += (Number(arr[i]) || 0) * w;
      tw += w;
    }
    return tw > 0 ? ws / tw : NaN;
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

  // lightweight mock historical helpers (kept for backwards compatibility)
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
    const s = String(sport || "").toUpperCase();
    const p = String(prop || "").toLowerCase();

    if (s === "MLB") {
      if (p.includes("strikeout")) return _mlbStrikeoutsFromRow(row);
      return NaN;
    }
    if (s === "NBA" || s === "WNBA") {
      if (p.includes("rebound")) return Number(row?.Rebounds ?? row?.ReboundsTotal ?? row?.REB ?? row?.REBPerGame) ?? NaN;
      if (p.includes("assist")) return Number(row?.Assists ?? row?.AST ?? row?.ASTPerGame) ?? NaN;
      if (p.includes("point") || p.includes("pts") || p.includes("score")) return Number(row?.Points ?? row?.PTS ?? row?.PTSPerGame) ?? NaN;
      return NaN;
    }
    if (s === "NFL") {
      if (p.includes("passing")) return Number(row?.PassingYards ?? row?.PassYds ?? row?.PassingYardsPerGame) ?? NaN;
      if (p.includes("rushing")) return Number(row?.RushingYards ?? row?.RushYds ?? row?.RushingYardsPerGame) ?? NaN;
      if (p.includes("receiving") || p.includes("receiving yards") || p.includes("rec")) return Number(row?.ReceivingYards ?? row?.RecYds ?? row?.ReceivingYardsPerGame) ?? NaN;
      return NaN;
    }
    return NaN;
  }

  _pushUsed(tag) {
    try {
      _uniqPush(this.usedEndpoints, tag);
    } catch {}
  }

  async _byDateArray(sport, dateStr) {
    const c = this.apiClient;
    if (!c) return [];
    try {
      if (sport === "MLB" && typeof c.getMLBPlayerStatsByDate === "function") {
        this._pushUsed(`MLB:player-stats-by-date:${dateStr}`);
        return (await c.getMLBPlayerStatsByDate(dateStr)) || [];
      }
      if (sport === "NBA" && typeof c.getNBAPlayerStatsByDate === "function") {
        this._pushUsed(`NBA:player-stats-by-date:${dateStr}`);
        return (await c.getNBAPlayerStatsByDate(dateStr)) || [];
      }
      if (sport === "WNBA" && typeof c.getWNBAPlayerStatsByDate === "function") {
        this._pushUsed(`WNBA:player-stats-by-date:${dateStr}`);
        return (await c.getWNBAPlayerStatsByDate(dateStr)) || [];
      }
      if (sport === "NFL" && typeof c.getNFLPlayerStatsByDate === "function") {
        this._pushUsed(`NFL:player-stats-by-date:${dateStr}`);
        return (await c.getNFLPlayerStatsByDate(dateStr)) || [];
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
        return (await c.getMLBPlayerSeasonStats(season)) || [];
      }
      if (sport === "NBA" && typeof c.getNBAPlayerSeasonStats === "function") {
        this._pushUsed(`NBA:player-season-stats:${season}`);
        return (await c.getNBAPlayerSeasonStats(season)) || [];
      }
      if (sport === "WNBA" && typeof c.getWNBAPlayerSeasonStats === "function") {
        this._pushUsed(`WNBA:player-season-stats:${season}`);
        return (await c.getWNBAPlayerSeasonStats(season)) || [];
      }
      if (sport === "NFL" && typeof c.getNFLPlayerSeasonStats === "function") {
        this._pushUsed(`NFL:player-season-stats:${season}`);
        return (await c.getNFLPlayerSeasonStats(season)) || [];
      }
    } catch (err) {
      console.warn("[PlayerPropsEngine] _seasonArray failed", err?.message || err);
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
          try {
            row = arr.find((r) => Number(r?.[idHint.key]) === Number(idHint.value));
          } catch {}
        }
        if (!row) {
          row = arr.find((r) => {
            try {
              return nameMatch(r?.Name || r?.FullName || r?.PlayerName);
            } catch {
              return false;
            }
          });
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
      const arr = await this._nflWeekArray(season, w);
      if (arr.length) {
        let row = null;

        if (idHint && idHint.key && idHint.value != null) {
          row = arr.find((r) => Number(r?.[idHint.key]) === Number(idHint.value));
        }
        if (!row) {
          row = arr.find((r) => nameMatch(r?.Name || r?.PlayerName || r?.FullName));
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
    const arr = (await c.getNFLPlayerGameStatsByWeek(season, week)) || [];
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
        const datesToTry = [0, -1, -2].map((off) => {
          const d = new Date(base);
          d.setDate(d.getDate() + off);
          return fmtLocalDate(d);
        });

        const nameMatch = _tokNameMatchFactory(input.player);
        let matched = null;
        let idHint = null;

        // attempt date-by-date matching to attach player id hint
        for (const dStr of datesToTry) {
          const stats = await this._byDateArray(sport, dStr);
          if (Array.isArray(stats) && stats.length) {
            matched = stats.find((s) => {
              try {
                return nameMatch(s?.Name || s?.PlayerName || s?.FullName);
              } catch {
                return false;
              }
            });
            if (matched) {
              this.matchedName = String(matched.Name || matched.PlayerName || matched.FullName || "");
              if (matched.PlayerID) idHint = { key: "PlayerID", value: matched.PlayerID };
              break;
            }
          }
        }

        // Season array fetch and seasonAvg derivation
        let seasonArr = [];
        try {
          seasonArr = (await this._seasonArray(sport, seasonYear)) || [];
        } catch (err) {
          console.warn("[PlayerPropsEngine] seasonArray fetch failed", err?.message || err);
        }
        let seasonAvg = NaN;
        if (Array.isArray(seasonArr) && seasonArr.length) {
          const sRow = seasonArr.find((r) => {
            try {
              if (r?.PlayerID && matched?.PlayerID && Number(r.PlayerID) === Number(matched.PlayerID)) return true;
              return _tokNameMatchFactory(input.player)(r?.Name || r?.PlayerName || r?.FullName);
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
        }

        // collect recent values (NFL uses weekly endpoint)
        let recentVals = [];
        if (sport === "NFL") {
          const c = this.apiClient;
          let season = seasonYear;
          let curWeek = null;
          if (typeof c.getNFLSeasonCurrent === "function") {
            try {
              const s = await c.getNFLSeasonCurrent();
              if (Number(s)) season = Number(s);
            } catch {}
          }
          if (typeof c.getNFLWeekCurrent === "function") {
            try {
              const w = await c.getNFLWeekCurrent();
              if (Number(w)) curWeek = Number(w);
            } catch {}
          }
          if (!curWeek) curWeek = 18;
          recentVals = await this._collectNFLRecents(input, season, curWeek, 8, idHint);
        } else {
          recentVals = await this._collectRecentByDate(input, sport, dateStr, sport === "MLB" ? 120 : 45, 10, idHint);
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

  // --- evaluateProp: always returns a consistent object and never pure NO DATA ---
  async evaluateProp(input) {
    try {
      // basic input validation
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

      // avgRecent (may be empty)
      const avgRecent =
        Array.isArray(features.recentSample) && features.recentSample.length > 0
          ? features.recentSample.reduce((a, b) => a + b, 0) / features.recentSample.length
          : NaN;

      // FALLBACK: if avgRecent is not finite, use seasonAvg (if finite)
      let usedAvg = Number.isFinite(avgRecent) ? avgRecent : Number.isFinite(features.seasonAvg) ? features.seasonAvg : NaN;

      // SECONDARY FALLBACK: try league averages via apiClient
      if (!Number.isFinite(usedAvg)) {
        try {
          if (this.apiClient && typeof this.apiClient.getLeagueAverages === "function") {
            const la = await this.apiClient.getLeagueAverages(String(input.sport || input?.sport || "").toUpperCase(), input.prop);
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

      // THIRD FALLBACK: StatisticalModels baseline
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

      // LAST RESORT: hardcoded conservative defaults based on prop wording
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

      // Compute a simple model probability based on difference between usedAvg and line
      let modelProb = 0.5;
      if (Number.isFinite(usedAvg) && Number.isFinite(line) && (sampleSize > 0 || Number.isFinite(features.seasonAvg))) {
        const gap = usedAvg - line; // positive -> favors OVER
        const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
        const sizeFactor = sampleSize > 0 ? Math.min(1.5, Math.sqrt(sampleSize) / (1 + variance / 4)) : 0.6;
        modelProb = clamp01(0.5 + normalized * 0.15 * sizeFactor);
      } else {
        // if we only have fallback usedAvg vs line, give a conservative adjustment
        if (Number.isFinite(usedAvg) && Number.isFinite(line)) {
          const gap = usedAvg - line;
          const normalized = Math.max(-1, Math.min(1, gap / Math.max(1, Math.abs(line))));
          modelProb = clamp01(0.5 + normalized * 0.08); // less aggressive for fallbacks
        } else {
          modelProb = 0.5;
        }
      }

      // Convert to confidence % (one decimal)
      const finalConfidence = Math.round(modelProb * 1000) / 10;

      // Determine raw pick (always provide)
      let pickDecision = "PASS";
      if (Number.isFinite(usedAvg) && Number.isFinite(line)) {
        pickDecision = usedAvg > line ? "OVER" : "UNDER";
      } else if (Number.isFinite(line)) {
        // no numeric avg found but line exists -> lean under (legacy), but mark low confidence
        pickDecision = "UNDER";
      } else {
        pickDecision = "PASS";
      }

      // Flags
      const flags = Array.isArray(this.errorFlags) ? [...this.errorFlags] : [];
      const lcThreshold = this.thresholds.LEAN * 100; // e.g., 65
      if (!Number.isFinite(finalConfidence) || finalConfidence < lcThreshold) {
        if (!flags.includes("low_confidence")) flags.push("low_confidence");
        if (pickDecision === "OVER" || pickDecision === "UNDER") {
          pickDecision = `${pickDecision} (Low Confidence)`;
        }
      }

      // Build suggestion and stake heuristics (kept conservative)
      const suggestion = pickDecision.includes("OVER") ? "Bet Over" : pickDecision.includes("UNDER") ? "Bet Under" : "Skip";
      let suggestedStake = 0;
      if (Number.isFinite(finalConfidence) && finalConfidence >= this.thresholds.LEAN * 100) {
        suggestedStake = Math.round(((finalConfidence - 50) / 50) * 5); // up to ~5% for high conf
        suggestedStake = Math.max(1, Math.min(5, suggestedStake));
      } else {
        suggestedStake = 0; // no stake on low confidence
      }

      // Top drivers: show what was actually used
      const topDrivers = [
        `Recent avg = ${Number.isFinite(avgRecent) ? round2(avgRecent) : "N/A"}`,
        `Season avg (fallback) = ${Number.isFinite(features.seasonAvg) ? round2(features.seasonAvg) : "N/A"}`,
        `Used avg = ${Number.isFinite(usedAvg) ? round2(usedAvg) : "N/A"}`,
        `Line = ${Number.isFinite(line) ? round2(line) : "N/A"}`,
        `Sample size = ${sampleSize}`,
        `Data source = ${this.dataSource}`,
      ];

      // Raw numbers
      return {
        player: input.player,
        prop: input.prop,
        decision: pickDecision,
        finalConfidence,
        suggestion,
        suggestedStake,
        topDrivers,
        flags,
        rawNumbers: {
          avgRecent: Number.isFinite(avgRecent) ? round3(avgRecent) : null,
          seasonAvg: Number.isFinite(features.seasonAvg) ? round3(features.seasonAvg) : null,
          usedAvg: Number.isFinite(usedAvg) ? round3(usedAvg) : null,
          line,
          sampleSize,
          variance: round3(variance),
          modelProb: round3(modelP
