// lib/apiClient.js
// SportsDataIO API Client — primary: SportsDataIO with local cache
// Enhanced with opening odds, rosters, and league averages support

import fetch from "node-fetch";
import cacheClient from "./cacheClient.js";

function resolveEnvApiKey() {
  const names = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_API_KEY",
    "SPORTS_DATA_KEY"
  ];
  for (const n of names) {
    if (process.env[n] && String(process.env[n]).trim() !== "") return String(process.env[n]).trim();
  }
  return "";
}

function resolveOddsApiKey() {
  const names = ["ODDS_API_KEY", "ODDSAPI_KEY", "THEODDS_API_KEY"];
  for (const n of names) {
    if (process.env[n] && String(process.env[n]).trim() !== "") return String(process.env[n]).trim();
  }
  return "";
}

export class SportsDataIOClient {
  constructor(opts = {}) {
    this.apiKey = (opts.apiKey || "").trim() || resolveEnvApiKey();
    this.baseURL = (opts.baseURL || process.env.SPORTSDATA_BASEURL || "https://api.sportsdata.io/v3").replace(/\/+$/, "");
    this.cacheTTL = Number(opts.cacheTTL || process.env.SPORTSDATA_CACHE_TTL || 3600); // default 1 hour
    this.lastHttp = null;
    this.oddsApiKey = (opts.oddsApiKey || "").trim() || resolveOddsApiKey();
  }

  setApiKey(k) { this.apiKey = (k||"").trim(); }
  setOddsApiKey(k) { this.oddsApiKey = (k||"").trim(); }

  async _getWithCache(path, params = {}, ttlSeconds = this.cacheTTL) {
    const cacheKey = `${path}|${JSON.stringify(params)}`;
    return await cacheClient.getOrFetch(cacheKey, params, ttlSeconds, async () => {
      const url = new URL(this.baseURL + path);
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
      try {
        const resp = await fetch(url.toString(), {
          headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": this.apiKey },
        });
        this.lastHttp = { status: resp.status, ok: resp.ok, url: url.toString() };
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>"");
          console.warn(`[SportsDataIOClient] non-200 ${resp.status} ${url}: ${txt}`);
          return null;
        }
        const json = await resp.json().catch(()=>null);
        return json;
      } catch (err) {
        console.warn("[SportsDataIOClient] fetch error", err?.message || err);
        return null;
      }
    });
  }

  // ========== OPENING ODDS METHODS (NEW) ==========
  
  /**
   * Get opening odds from SportsDataIO for a specific player prop
   * @param {string} sport - Sport code (NBA, MLB, NFL, WNBA)
   * @param {string} playerName - Player name
   * @param {string} propType - Prop type (rebounds, assists, points, strikeouts, etc.)
   * @param {string} gameDate - Date in YYYY-MM-DD format
   * @returns {object|null} Opening odds data with openingLine, openingPrice, timestamp
   */
  async getSDIOOpeningOdds(sport, playerName, propType, gameDate) {
    try {
      // SportsDataIO typically provides historical odds via PlayerProp endpoints
      // This is a best-effort attempt - SDIO API may vary by subscription level
      const sportLower = String(sport || "").toLowerCase();
      const candidates = [
        `/${sportLower}/odds/json/PlayerPropsByDate/${gameDate}`,
        `/${sportLower}/odds/json/AlternateMarketPlayerPropsByDate/${gameDate}`,
        `/${sportLower}/odds/json/GameOddsByDate/${gameDate}` // fallback to game odds
      ];

      for (const path of candidates) {
        const data = await this._getWithCache(path, {}, this.cacheTTL);
        if (!data) continue;

        // If it's an array of player props, find matching player/prop
        if (Array.isArray(data)) {
          const match = data.find(p => {
            const pName = String(p?.PlayerName || p?.Name || "").toLowerCase();
            const targetName = String(playerName || "").toLowerCase();
            const pType = String(p?.PropType || p?.MarketType || "").toLowerCase();
            const targetProp = String(propType || "").toLowerCase();
            
            return pName.includes(targetName) && pType.includes(targetProp);
          });

          if (match && match.OpeningLine !== undefined) {
            return {
              openingLine: Number(match.OpeningLine),
              openingPrice: Number(match.OpeningPrice || match.OpeningOdds || -110),
              source: "SDIO",
              timestamp: match.Updated || new Date().toISOString()
            };
          }
        }
      }

      console.warn(`[SDIO] No opening odds found for ${playerName} ${propType} on ${gameDate}`);
      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getSDIOOpeningOdds failed", err?.message || err);
      return null;
    }
  }

  /**
   * Get opening odds from OddsAPI (fallback)
   * @param {string} sport - Sport code
   * @param {string} playerName - Player name
   * @param {string} propType - Prop type
   * @param {string} gameDate - Date in YYYY-MM-DD format
   * @returns {object|null} Opening odds data
   */
  async getOddsAPIOpeningOdds(sport, playerName, propType, gameDate) {
    if (!this.oddsApiKey) {
      console.warn("[OddsAPI] No API key configured");
      return null;
    }

    try {
      const sportKeyMap = { 
        MLB: "baseball_mlb", 
        NBA: "basketball_nba", 
        WNBA: "basketball_wnba", 
        NFL: "americanfootball_nfl" 
      };
      const sportKey = sportKeyMap[String(sport).toUpperCase()];
      if (!sportKey) return null;

      const base = "https://api.the-odds-api.com/v4";
      const url = new URL(`${base}/sports/${sportKey}/odds`);
      url.searchParams.set("apiKey", this.oddsApiKey);
      url.searchParams.set("regions", "us");
      url.searchParams.set("markets", "player_props");
      url.searchParams.set("dateFormat", "iso");

      const resp = await fetch(url.toString());
      if (!resp.ok) {
        console.warn("[OddsAPI] Non-200 response:", resp.status);
        return null;
      }

      const json = await resp.json();
      if (!Array.isArray(json)) return null;

      // Search for matching player prop in the games
      for (const game of json) {
        if (!game.bookmakers) continue;
        for (const bookmaker of game.bookmakers) {
          if (!bookmaker.markets) continue;
          for (const market of bookmaker.markets) {
            if (!market.outcomes) continue;
            const match = market.outcomes.find(o => {
              const oName = String(o?.description || o?.name || "").toLowerCase();
              const targetName = String(playerName || "").toLowerCase();
              return oName.includes(targetName);
            });

            if (match && match.point !== undefined) {
              return {
                openingLine: Number(match.point),
                openingPrice: Number(match.price || -110),
                source: "OddsAPI",
                timestamp: game.commence_time || new Date().toISOString()
              };
            }
          }
        }
      }

      console.warn(`[OddsAPI] No opening odds found for ${playerName} ${propType}`);
      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getOddsAPIOpeningOdds failed", err?.message || err);
      return null;
    }
  }

  // ========== ROSTER METHODS (NEW) ==========
  
  async getNBARosters() {
    try {
      const data = await this._getWithCache("/nba/scores/json/Players", {}, this.cacheTTL);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn("[SportsDataIOClient] getNBARosters failed", err?.message || err);
      return [];
    }
  }

  async getWNBARosters() {
    try {
      const data = await this._getWithCache("/wnba/scores/json/Players", {}, this.cacheTTL);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn("[SportsDataIOClient] getWNBARosters failed", err?.message || err);
      return [];
    }
  }

  async getNFLRosters() {
    try {
      const data = await this._getWithCache("/nfl/scores/json/Players", {}, this.cacheTTL);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn("[SportsDataIOClient] getNFLRosters failed", err?.message || err);
      return [];
    }
  }

  // ========== LEAGUE AVERAGES (NEW) ==========
  
  /**
   * Get league average for a specific stat/prop type
   * @param {string} sport - Sport code
   * @param {string} prop - Prop description (e.g., "Points 23.5", "Rebounds", etc.)
   * @returns {number|null} League average value
   */
  async getLeagueAverages(sport, prop) {
    try {
      const propLower = String(prop || "").toLowerCase();
      
      // Hardcoded league averages as fallback (can be replaced with API calls if available)
      const averages = {
        NBA: {
          points: 15.5,
          rebounds: 6.2,
          assists: 3.8,
          steals: 1.1,
          blocks: 0.8,
          threes: 1.5,
        },
        WNBA: {
          points: 11.2,
          rebounds: 5.1,
          assists: 2.9,
          steals: 1.0,
          blocks: 0.6,
        },
        MLB: {
          strikeouts: 5.8,
          hits: 1.2,
          runs: 0.8,
          rbis: 0.9,
        },
        NFL: {
          passing_yards: 235,
          rushing_yards: 68,
          receiving_yards: 48,
          touchdowns: 1.2,
        }
      };

      const sportUpper = String(sport || "").toUpperCase();
      const sportAvgs = averages[sportUpper];
      if (!sportAvgs) return null;

      // Match prop type to stat category
      if (propLower.includes("point") || propLower.includes("pts")) return sportAvgs.points;
      if (propLower.includes("rebound") || propLower.includes("reb")) return sportAvgs.rebounds;
      if (propLower.includes("assist") || propLower.includes("ast")) return sportAvgs.assists;
      if (propLower.includes("steal")) return sportAvgs.steals;
      if (propLower.includes("block")) return sportAvgs.blocks;
      if (propLower.includes("three") || propLower.includes("3pt")) return sportAvgs.threes;
      if (propLower.includes("strikeout") || propLower.includes("k")) return sportAvgs.strikeouts;
      if (propLower.includes("hit")) return sportAvgs.hits;
      if (propLower.includes("run")) return sportAvgs.runs;
      if (propLower.includes("rbi")) return sportAvgs.rbis;
      if (propLower.includes("passing")) return sportAvgs.passing_yards;
      if (propLower.includes("rushing")) return sportAvgs.rushing_yards;
      if (propLower.includes("receiving")) return sportAvgs.receiving_yards;
      if (propLower.includes("touchdown") || propLower.includes("td")) return sportAvgs.touchdowns;

      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getLeagueAverages failed", err?.message || err);
      return null;
    }
  }

  // ========== EXISTING METHODS ==========

  async getClosingLine(gameId, propId = null) {
    try {
      if (propId) {
        const candidates = [
          `/odds/json/PlayerProp/${encodeURIComponent(propId)}`,
          `/odds/json/PlayerProps/${encodeURIComponent(propId)}`
        ];
        for (const p of candidates) {
          const data = await this._getWithCache(p, {}, this.cacheTTL);
          if (data && typeof data?.ClosingLine === "number") return data.ClosingLine;
        }
        return null;
      } else if (gameId) {
        const candidates = [
          `/odds/json/Game/${encodeURIComponent(gameId)}`,
          `/odds/json/GameOddsByGame/${encodeURIComponent(gameId)}`
        ];
        for (const p of candidates) {
          const data = await this._getWithCache(p, {}, this.cacheTTL);
          if (data && typeof data?.ClosingLine === "number") return data.ClosingLine;
        }
        return null;
      }
      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getClosingLine failed", err?.message || err);
      return null;
    }
  }

  // Season & by-date stats
  getMLBPlayerSeasonStats(season) { return this._getWithCache(`/mlb/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNBAPlayerSeasonStats(season) { return this._getWithCache(`/nba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getWNBAPlayerSeasonStats(season) { return this._getWithCache(`/wnba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNFLPlayerSeasonStats(season) { return this._getWithCache(`/nfl/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }

  getMLBPlayerStatsByDate(date) { return this._getWithCache(`/mlb/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getNBAPlayerStatsByDate(date) { return this._getWithCache(`/nba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAPlayerStatsByDate(date) { return this._getWithCache(`/wnba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }

  // MLB Game Logs - NEW
  async getMLBPlayerGameLogs(playerName, season = "2024", count = 20) {
    try {
      const seasonStats = await this.getMLBPlayerSeasonStats(season);
      if (!Array.isArray(seasonStats)) return [];
      
      const player = seasonStats.find(p => {
        const name = String(p?.Name || "").toLowerCase();
        const target = String(playerName || "").toLowerCase();
        return name.includes(target) || target.includes(name);
      });
      
      if (!player || !player.PlayerID) return [];
      
      const gameLogs = await this._getWithCache(
        `/mlb/stats/json/PlayerGameStatsBySeason/${season}/${player.PlayerID}`,
        {},
        this.cacheTTL
      );
      
      if (!Array.isArray(gameLogs)) return [];
      
      return gameLogs
        .filter(g => g && g.DateTime)
        .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
        .slice(0, count);
    } catch (err) {
      console.warn("[SportsDataIOClient] getMLBPlayerGameLogs failed", err?.message || err);
      return [];
    }
  }

  // NFL
  getNFLSeasonCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentSeason`, {}, this.cacheTTL); }
  getNFLWeekCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentWeek`, {}, this.cacheTTL); }
  getNFLPlayerGameStatsByWeek(season, week) { return this._getWithCache(`/nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}`, {}, this.cacheTTL); }

  // Odds endpoints (SDIO)
  getMLBGameOdds(date) { return this._getWithCache(`/mlb/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNBAGameOdds(date) { return this._getWithCache(`/nba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAGameOdds(date) { return this._getWithCache(`/wnba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNFLGameOdds(week) { return this._getWithCache(`/nfl/odds/json/GameOddsByWeek/${week}`, {}, this.cacheTTL); }

  // OddsAPI fallback (TheOddsAPI) - fetch game odds by date and sport
  async getOddsFromOddsAPI({ sport, date }) {
    if (!this.oddsApiKey) return null;
    try {
      const base = "https://api.the-odds-api.com/v4";
      const sportKeyMap = { 
        MLB: "baseball_mlb", 
        NBA: "basketball_nba", 
        WNBA: "basketball_wnba", 
        NFL: "americanfootball_nfl" 
      };
      const key = sportKeyMap[sport] || null;
      if (!key) return null;
      
      const url = new URL(`${base}/sports/${key}/odds`);
      if (date) url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("regions", "us");
      url.searchParams.set("markets", "h2h,spreads");
      url.searchParams.set("apiKey", this.oddsApiKey);
      
      const resp = await fetch(url.toString());
      if (!resp.ok) {
        const txt = await resp.text().catch(()=>"");
        console.warn("[OddsAPI] non-200", resp.status, txt);
        return null;
      }
      const json = await resp.json().catch(()=>null);
      return json;
    } catch (err) {
      console.warn("[OddsAPI] fetch error", err?.message || err);
      return null;
    }
  }
}

// singleton
const defaultClient = new SportsDataIOClient({});
export const apiClient = defaultClient;
export { SportsDataIOClient as APIClient };
export default defaultClient;
