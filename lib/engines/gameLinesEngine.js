// lib/engines/gameLinesEngine.js
// Market-heavy moneyline engine powered by SportsDataIO pregame odds.
// Synced with lean apiClient.js (generic .get()) and CLV-ready.

import { apiClient } from "../apiClient.js";
import { computeClvEdge } from "../clvTracker.js";

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

export class GameLinesEngine {
  constructor(client = apiClient) {
    this.apiClient = client;
    this.usedEndpoints = [];
    this.dataSource = "fallback";
    this.matchInfo = null;
    this.calibrationFactor = 1.0;

    this.thresholds = {
      LOCK_CONFIDENCE: 0.70,
      STRONG_LEAN: 0.675,
      LEAN: 0.65,
    };
  }

  _fuse(modelProb, marketProb, sharpSignal = 0, addOnNudges = 0) {
    const base =
      0.25 * modelProb + 0.65 * marketProb + 0.1 * (0.5 + sharpSignal);
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
    try {
      let path;
      switch (sport) {
        case "NBA":
          path = `/odds/json/GameOddsByDate/NBA/${dateOrWeek}`;
          break;
        case "MLB":
          path = `/odds/json/GameOddsByDate/MLB/${dateOrWeek}`;
          break;
        case "WNBA":
          path = `/odds/json/GameOddsByDate/WNBA/${dateOrWeek}`;
          break;
        case "NFL":
          path = `/odds/json/GameOddsByWeek/NFL/${dateOrWeek}`;
          break;
        default:
          return [];
      }
      const r = await this.apiClient.get(path);
      this.usedEndpoints.push(`${sport}:${path}`);
      return Array.isArray(r) ? r : [];
    } catch (err) {
      console.warn(`[GameLinesEngine] fetchOdds failed`, err.message);
      return [];
    }
  }

  async evaluateGame(inputRaw) {
    const input = {
      sport: String(inputRaw?.sport || "NBA").toUpperCase(),
      team: inputRaw?.team || "",
      opponent: inputRaw?.opponent || "",
      startTime: inputRaw?.startTime || new Date().toISOString(),
    };

    let dateStr;
    try {
      const d = input.startTime ? new Date(input.startTime) : new Date();
      if (!Number.isFinite(d.getTime())) throw new Error("bad date");
      dateStr = fmtLocalDate(d);
    } catch {
      dateStr = fmtLocalDate(new Date());
    }

    let oddsList = [];
    if (input.sport === "NFL") {
      const { week } = this._inferNFLSeasonWeek(dateStr);
      oddsList = await this._fetchOdds("NFL", week);
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
        rawNumbers: { marketProbability: 0.5, modelProbability: 0.5, fusedProbability: 0.5 },
        meta: { dataSource: "fallback", usedEndpoints: this.usedEndpoints, note: "No odds found" },
      };
    }

    const tTok = tokens(input.team);
    const oTok = tokens(input.opponent);
    let matched = null;

    for (const g of oddsList) {
      const home =
        g?.HomeTeam ?? g?.HomeTeamName ?? g?.HomeTeamKey ?? g?.HomeTeamShort ?? "";
      const away =
        g?.AwayTeam ?? g?.AwayTeamName ?? g?.AwayTeamKey ?? g?.AwayTeamShort ?? "";
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
        rawNumbers: { marketProbability: 0.5, modelProbability: 0.5, fusedProbability: 0.5 },
        meta: { dataSource: "sportsdata", usedEndpoints: this.usedEndpoints, note: "No matching teams" },
      };
    }

    let mlHome = null,
      mlAway = null,
      book = "book";
    const books = Array.isArray(matched?.PregameOdds)
      ? matched.PregameOdds
      : Array.isArray(matched?.Odds)
      ? matched.Odds
      : null;

    if (Array.isArray(books)) {
      for (const b of books) {
        const h = Number(b?.HomeMoneyLine);
        const a = Number(b?.AwayMoneyLine);
        if (Number.isFinite(h) && Number.isFinite(a)) {
          mlHome = h;
          mlAway = a;
          book = b?.Sportsbook ?? b?.SportsbookDisplayName ?? "book";
          break;
        }
      }
    } else {
      mlHome = Number(matched?.HomeMoneyLine);
      mlAway = Number(matched?.AwayMoneyLine);
    }

    if (!Number.isFinite(mlHome) || !Number.isFinite(mlAway)) {
      return {
        side: input.team,
        suggestion: "MONEYLINE",
        decision: "PASS",
        finalConfidence: 49.9,
        rawNumbers: { marketProbability: 0.5, modelProbability: 0.5, fusedProbability: 0.5 },
        meta: { dataSource: "sportsdata", usedEndpoints: this.usedEndpoints, note: "No moneyline prices" },
      };
    }

    const pHome = impliedProbFromMoneyline(mlHome) ?? 0.5;
    const pAway = impliedProbFromMoneyline(mlAway) ?? 0.5;
    const norm = pHome + pAway;
    const mHome = norm > 0 ? pHome / norm : 0.5;
    const mAway = norm > 0 ? pAway / norm : 0.5;

    const homeTeam = matched?.HomeTeam ?? matched?.HomeTeamName ?? "";
    const userWantsHome = teamMatches(tokens(input.team), homeTeam);
    const marketProb = userWantsHome ? mHome : mAway;

    const modelProb = 0.5; // placeholder for fusion
    const fused = this._fuse(modelProb, marketProb, 0, 0);
    const finalConfidence = Math.round(fused * 1000) / 10;

    const decision =
      finalConfidence >= this.thresholds.LOCK_CONFIDENCE * 100
        ? "LOCK"
        : finalConfidence >= this.thresholds.STRONG_LEAN * 100
        ? "STRONG_LEAN"
        : finalConfidence >= this.thresholds.LEAN * 100
        ? "LEAN"
        : "PASS";

    // Attach CLV edge if closing line is available
    let clvEdge = null;
    try {
      const closing = await this.apiClient.getClosingLine(matched.GameID);
      if (closing !== null) {
        const opening = userWantsHome ? mlHome : mlAway;
        clvEdge = computeClvEdge(opening, closing);
      }
    } catch {}

    this.matchInfo = {
      home: homeTeam,
      away: matched?.AwayTeam ?? matched?.AwayTeamName ?? "",
      book,
      mlHome,
      mlAway,
      marketHome: mHome,
      marketAway: mAway,
    };

    return {
      side: input.team,
      suggestion: "MONEYLINE",
      decision,
      finalConfidence,
      rawNumbers: {
        marketProbability: Number(marketProb.toFixed(3)),
        modelProbability: Number(modelProb.toFixed(3)),
        fusedProbability: Number(fused.toFixed(3)),
        clvEdge: clvEdge !== null ? Number(clvEdge.toFixed(4)) : null,
      },
      meta: { dataSource: "sportsdata", usedEndpoints: this.usedEndpoints, matchInfo: this.matchInfo },
    };
  }
}
