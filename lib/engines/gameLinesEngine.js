// lib/engines/gameLinesEngine.js
// Market-heavy moneyline engine powered by SportsDataIO pregame odds
// Enhanced with opening odds tracking and CLV computation

function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const tokens = (s) => String(s || "").toLowerCase().split(/\s+/).filter(Boolean);
const teamMatches = (toks, s) => {
  const c = String(s || "").toLowerCase();
  return toks.some((t) => c.includes(t));
};
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0));

function impliedProbFromMoneyline(ml) {
  const n = Number(ml);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

// Team alias dictionary (expand as needed)
const TEAM_ALIASES = {
  MIN: "Vikings", SF: "49ers", GB: "Packers", KC: "Chiefs", DAL: "Cowboys",
  NE: "Patriots", NYJ: "Jets", NYG: "Giants", LV: "Raiders", LVR: "Raiders",
  LAC: "Chargers", SD: "Chargers", NO: "Saints", TB: "Buccaneers",
  MIA: "Dolphins", BUF: "Bills", PHI: "Eagles", WAS: "Commanders",
  WSH: "Commanders", HOU: "Texans", JAX: "Jaguars", JAC: "Jaguars",
  PIT: "Steelers", CLE: "Browns", CIN: "Bengals", CHI: "Bears",
  DET: "Lions", ATL: "Falcons", CAR: "Panthers", SEA: "Seahawks",
  ARI: "Cardinals", DEN: "Broncos", TEN: "Titans", IND: "Colts",
  BAL: "Ravens", LA: "Rams", LAR: "Rams",
};

function normalizeTeamName(nameOrAbbr) {
  const key = String(nameOrAbbr || "").toUpperCase();
  return TEAM_ALIASES[key] || nameOrAbbr;
}

// Normalize OddsAPI odds into SportsDataIO-like structure
function normalizeOdds(odds, source) {
  if (source === "SportsDataIO") return odds;
  if (source === "OddsAPI" && Array.isArray(odds)) {
    return odds.map((g) => {
      const home = g?.home_team || "";
      const away = g?.away_team || "";
      const book = g?.bookmakers?.[0];
      let mlHome = null, mlAway = null;
      if (book?.markets) {
        const h2h = book.markets.find((m) => m.key === "h2h");
        if (h2h?.outcomes) {
          for (const o of h2h.outcomes) {
            if (o.name === home) mlHome = o.price;
            if (o.name === away) mlAway = o.price;
          }
        }
      }
      return {
        HomeTeam: home,
        AwayTeam: away,
        HomeMoneyLine: mlHome,
        AwayMoneyLine: mlAway,
        Sportsbook: book?.title || "oddsapi",
      };
    });
  }
  return [];
}

// CLV computation helper
function _computeCLV(openingLine, currentLine, openingPrice, currentPrice) {
  try {
    if (!Number.isFinite(openingPrice) || !Number.isFinite(currentPrice)) {
      return null;
    }

    const openingProb = impliedProbFromMoneyline(openingPrice) || 0.5;
    const currentProb = impliedProbFromMoneyline(currentPrice) || 0.5;
    const probDiff = (currentProb - openingProb) * 100;

    const clvPercent = Math.round(probDiff * 100) / 100;
    let favorability = "neutral";
    if (clvPercent > 2) favorability = "favorable";
    else if (clvPercent < -2) favorability = "unfavorable";

    return {
      percent: clvPercent,
      direction: clvPercent > 0 ? "positive" : clvPercent < 0 ? "negative" : "none",
      favorability,
      openingImpliedProb: Math.round(openingProb * 1000) / 1000,
      currentImpliedProb: Math.round(currentProb * 1000) / 1000,
    };
  } catch (err) {
    console.warn("[GameLinesEngine] CLV computation failed:", err?.message || err);
    return null;
  }
}

export class GameLinesEngine {
  constructor(apiClient) {
    this.apiClient = apiClient || null;
    this.usedEndpoints = [];
    this.dataSource = "fallback";
    this.matchInfo = null;
    this.calibrationFactor = 1.0;

    this.thresholds = {
      LOCK_CONFIDENCE: 0.7,
      STRONG_LEAN: 0.675,
      LEAN: 0.65,
    };
  }

  _fuse(modelProb, marketProb, sharpSignal = 0, addOnNudges = 0) {
    const base = 0.25 * modelProb + 0.65 * marketProb + 0.1 * (0.5 + sharpSignal);
    return clamp01((base + addOnNudges) * this.calibrationFactor);
  }

  _inferNFLSeasonWeek(dateStr) {
    const d = new Date(dateStr);
    let season = d.getFullYear();
    const month = d.getMonth() + 1;
    if (month < 3) season -= 1;
    const sep1 = new Date(season, 8, 1);
    const firstThu = new Date(sep1);
    while (firstThu.getDay() !== 4) firstThu.setDate(firstThu.getDate() + 1);
    const diffDays = Math.floor((d - firstThu) / 86400000);
    let week = Math.max(1, Math.min(22, Math.floor(diffDays / 7) + 1));
    return { season, week };
  }

  async _fetchOdds(sport, dateOrWeek) {
    if (!this.apiClient) return [];
    try {
      let r = [];
      if (sport === "MLB" && this.apiClient.getMLBGameOdds) {
        r = await this.apiClient.getMLBGameOdds(dateOrWeek);
        this.usedEndpoints.push(`MLB:game-odds:${dateOrWeek}`);
        return normalizeOdds(r, "SportsDataIO");
      }
      if (sport === "NBA" && this.apiClient.getNBAGameOdds) {
        r = await this.apiClient.getNBAGameOdds(dateOrWeek);
        this.usedEndpoints.push(`NBA:game-odds:${dateOrWeek}`);
        return normalizeOdds(r, "SportsDataIO");
      }
      if (sport === "WNBA" && this.apiClient.getWNBAGameOdds) {
        r = await this.apiClient.getWNBAGameOdds(dateOrWeek);
        this.usedEndpoints.push(`WNBA:game-odds:${dateOrWeek}`);
        return normalizeOdds(r, "SportsDataIO");
      }
      if (sport === "NFL" && this.apiClient.getNFLGameOdds) {
        r = await this.apiClient.getNFLGameOdds(dateOrWeek);
        this.usedEndpoints.push(`NFL:game-odds:${dateOrWeek}`);
        return normalizeOdds(r, "SportsDataIO");
      }
      // fallback to OddsAPI
      if (this.apiClient.getOddsFromOddsAPI) {
        const oddsapi = await this.apiClient.getOddsFromOddsAPI({
          sport,
          date: dateOrWeek,
        });
        if (oddsapi) {
          this.usedEndpoints.push(`${sport}:oddsapi:${dateOrWeek}`);
          return normalizeOdds(oddsapi, "OddsAPI");
        }
      }
    } catch (err) {
      console.warn("[GameLinesEngine] fetchOdds error:", err?.message || err);
    }
    return [];
  }

  async evaluateGame(inputRaw) {
    const input = {
      sport: String(inputRaw?.sport || "NBA").toUpperCase(),
      team: normalizeTeamName(inputRaw?.team || ""),
      opponent: normalizeTeamName(inputRaw?.opponent || ""),
      startTime: inputRaw?.startTime || new Date().toISOString(),
      currentPrice: inputRaw?.currentPrice || inputRaw?.odds?.home || -110,
    };

    // Date string
    let dateStr;
    try {
      const d = input.startTime ? new Date(input.startTime) : new Date();
      if (!Number.isFinite(d.getTime())) throw new Error("bad date");
      dateStr = fmtLocalDate(d);
    } catch {
      dateStr = fmtLocalDate(new Date());
    }

    // Pull odds
    let oddsList = [];
    if (input.sport === "NFL") {
      let week;
      try {
        week = await this.apiClient.getNFLWeekCurrent();
        this.usedEndpoints.push("NFL:week:current");
      } catch {
        const inf = this._inferNFLSeasonWeek(dateStr);
        week = inf.week;
      }
      oddsList = await this._fetchOdds("NFL", week);
      if (!oddsList.length) {
        for (let wOff = -1; wOff >= -3 && !oddsList.length; wOff--) {
          const { week: tryW } = this._inferNFLSeasonWeek(dateStr);
          const w2 = Math.max(1, tryW + wOff);
          const tmp = await this._fetchOdds("NFL", w2);
          if (tmp.length) oddsList = tmp;
        }
      }
    } else {
      const base = new Date(dateStr);
      const choices = [0, -1, 1].map((off) => {
        const d = new Date(base);
        d.setDate(d.getDate() + off);
        return fmtLocalDate(d);
      });
      for (const ds of choices) {
        const tmp = await this._fetchOdds(input.sport, ds);
        if (tmp.length) {
          oddsList = tmp;
          break;
        }
      }
    }

    if (!oddsList.length) {
      return {
        side: input.team,
        suggestion: "MONEYLINE",
        decision: "PASS",
        finalConfidence: 49.9,
        pick: input.team,
        flags: ["no_odds_found"],
        rawNumbers: {
          marketProbability: 0.5,
          modelProbability: 0.5,
          fusedProbability: 0.5,
        },
        oddsData: null,
        clv: null,
        meta: {
          dataSource: "fallback",
          usedEndpoints: this.usedEndpoints,
          note: "No odds found",
        },
      };
    }

    // Match game
    const tTok = tokens(input.team);
    const oTok = tokens(input.opponent);
    let matched = null;

    for (const g of oddsList) {
      const home = g?.HomeTeam ?? "";
      const away = g?.AwayTeam ?? "";
      const ok =
        (teamMatches(tTok, home) && teamMatches(oTok, away)) ||
        (teamMatches(tTok, away) && teamMatches(oTok, home));
      if (ok) {
        matched = g;
        break;
      }
    }

    if (!matched) {
      return {
        side: input.team,
        suggestion: "MONEYLINE",
        decision: "PASS",
        finalConfidence: 49.9,
        pick: input.team,
        flags: ["no_matching_team"],
        rawNumbers: {
          marketProbability: 0.5,
          modelProbability: 0.5,
          fusedProbability: 0.5,
        },
        oddsData: null,
        clv: null,
        meta: {
          dataSource: "sportsdata",
          usedEndpoints: this.usedEndpoints,
          note: "No matching teams",
        },
      };
    }

    // Extract moneylines
    let mlHome = null, mlAway = null, book = "book";
    if (Number.isFinite(matched?.HomeMoneyLine) && Number.isFinite(matched?.AwayMoneyLine)) {
      mlHome = Number(matched.HomeMoneyLine);
      mlAway = Number(matched.AwayMoneyLine);
      book = matched?.Sportsbook ?? "book";
    }

    if (!Number.isFinite(mlHome) || !Number.isFinite(mlAway)) {
      return {
        side: input.team,
        suggestion: "MONEYLINE",
        decision: "PASS",
        finalConfidence: 49.9,
        pick: input.team,
        flags: ["no_moneyline_prices"],
        rawNumbers: {
          marketProbability: 0.5,
          modelProbability: 0.5,
          fusedProbability: 0.5,
        },
        oddsData: null,
        clv: null,
        meta: {
          dataSource: "sportsdata",
          usedEndpoints: this.usedEndpoints,
          note: "No moneyline prices",
        },
      };
    }

    // Market probs
    const pHome = impliedProbFromMoneyline(mlHome) ?? 0.5;
    const pAway = impliedProbFromMoneyline(mlAway) ?? 0.5;
    const norm = pHome + pAway;
    const mHome = norm > 0 ? pHome / norm : 0.5;
    const mAway = norm > 0 ? pAway / norm : 0.5;

    const homeTeam = matched?.HomeTeam ?? "";
    const userWantsHome = teamMatches(tokens(input.team), homeTeam);
    const marketProb = userWantsHome ? mHome : mAway;

    // Opening odds (assume current odds are opening for now - can be enhanced)
    const openingPrice = userWantsHome ? mlHome : mlAway;
    const oddsData = {
      openingLine: null, // Game lines don't have a "line" in the same sense as props
      openingPrice: openingPrice,
      source: "SDIO",
      timestamp: new Date().toISOString(),
    };

    // CLV computation (if we have historical opening odds)
    const clv = _computeCLV(null, null, openingPrice, input.currentPrice);

    // Fuse with model (currently placeholder 0.5)
    const modelProb = 0.5;
    let fused = this._fuse(modelProb, marketProb, 0, 0);
    
    // Adjust for CLV if favorable
    if (clv && clv.favorability === "favorable") {
      fused = clamp01(fused + (clv.percent / 100) * 0.05);
    }

    const finalConfidence = Math.round(fused * 1000) / 10;
    const pick = input.team;

    let decisionLabel;
    const lcThreshold = this.thresholds.LEAN * 100;
    if (finalConfidence >= this.thresholds.LOCK_CONFIDENCE * 100) {
      decisionLabel = "LOCK";
    } else if (finalConfidence >= this.thresholds.STRONG_LEAN * 100) {
      decisionLabel = "STRONG_LEAN";
    } else if (finalConfidence >= this.thresholds.LEAN * 100) {
      decisionLabel = "LEAN";
    } else {
      decisionLabel = "LEAN (Low Confidence)";
    }

    const flags = [];
    if (finalConfidence < lcThreshold) flags.push("low_confidence");
    if (clv) {
      if (clv.favorability === "favorable") flags.push("positive_clv");
      else if (clv.favorability === "unfavorable") flags.push("negative_clv");
    }

    this.matchInfo = {
      home: homeTeam,
      away: matched?.AwayTeam ?? "",
      book,
      mlHome,
      mlAway,
      marketHome: mHome,
      marketAway: mAway,
    };

    return {
      side: input.team,
      suggestion: "MONEYLINE",
      decision: decisionLabel,
      finalConfidence,
      pick,
      flags,
      rawNumbers: {
        marketProbability: Number(marketProb.toFixed(3)),
        modelProbability: Number(modelProb.toFixed(3)),
        fusedProbability: Number(fused.toFixed(3)),
      },
      oddsData,
      clv,
      meta: {
        dataSource: "sportsdata",
        usedEndpoints: this.usedEndpoints,
        matchInfo: this.matchInfo,
      },
    };
  }
}
