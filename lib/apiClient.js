// lib/apiClient.js
// SportsDataIO API Client — primary: SportsDataIO with local cache
// Odds API removed - using internal house logic only

import fetch from "node-fetch";
import cacheClient from "./cacheClient.js";

function resolveEnvApiKey() {
  const names = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_KEY",
    "SPORTS_DATA_API_KEY"
  ];
  for (const n of names) {
    if (process.env[n] && String(process.env[n]).trim() !== "") return String(process.env[n]).trim();
  }
  return "";
}

// Auto-detect current MLB season from SportsDataIO
async function _detectMLBSeason(client) {
  try {
    // Try current year first
    const currentYear = new Date().getFullYear();
    const test = await client._getWithCache(`/mlb/stats/json/PlayerSeasonStats/${currentYear}`, {}, 60);
    if (Array.isArray(test) && test.length > 0) {
      console.log(`[_detectMLBSeason] Using season: ${currentYear}`);
      return currentYear;
    }
    
    // If current year fails, try previous year
    const prevYear = currentYear - 1;
    const testPrev = await client._getWithCache(`/mlb/stats/json/PlayerSeasonStats/${prevYear}`, {}, 60);
    if (Array.isArray(testPrev) && testPrev.length > 0) {
      console.log(`[_detectMLBSeason] Using season: ${prevYear}`);
      return prevYear;
    }
    
    // Fallback to previous year if both fail
    console.log(`[_detectMLBSeason] Fallback to season: ${prevYear}`);
    return prevYear;
  } catch {
    const fallback = new Date().getFullYear() - 1;
    console.log(`[_detectMLBSeason] Error, fallback to season: ${fallback}`);
    return fallback;
  }
}

export class SportsDataIOClient {
  constructor(opts = {}) {
    this.apiKey = (opts.apiKey || "").trim() || resolveEnvApiKey();
    this.baseURL = (opts.baseURL || process.env.SPORTSDATA_BASEURL || "https://api.sportsdata.io/v3").replace(/\/+$/, "");
    this.cacheTTL = Number(opts.cacheTTL || process.env.SPORTSDATA_CACHE_TTL || 3600); // default 1 hour
    this.lastHttp = null;
  }

  setApiKey(k) { this.apiKey = (k||"").trim(); }

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

  // ========== ROSTER METHODS ==========
  
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

  // ========== LEAGUE AVERAGES ==========
  
  async getLeagueAverages(sport, prop) {
    try {
      const propLower = String(prop || "").toLowerCase();
      
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

  // ========== SEASON & BY-DATE STATS ==========
  
  getMLBPlayerSeasonStats(season) { return this._getWithCache(`/mlb/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNBAPlayerSeasonStats(season) { return this._getWithCache(`/nba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getWNBAPlayerSeasonStats(season) { return this._getWithCache(`/wnba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNFLPlayerSeasonStats(season) { return this._getWithCache(`/nfl/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }

  getMLBPlayerStatsByDate(date) { return this._getWithCache(`/mlb/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getNBAPlayerStatsByDate(date) { return this._getWithCache(`/nba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAPlayerStatsByDate(date) { return this._getWithCache(`/wnba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }

  // ========== PLAYER GAME LOGS (LAST N GAMES ACTUALLY PLAYED) ==========
  
  async getMLBPlayerGameLogs(playerName, season = null, count = 15) {
    try {
      // Auto-detect season if not provided
      if (!season) {
        season = await _detectMLBSeason(this);
      }
      
      const seasonStats = await this.getMLBPlayerSeasonStats(season);
      if (!Array.isArray(seasonStats)) {
        console.log(`[getMLBPlayerGameLogs] No season stats for ${season}`);
        return [];
      }
      
      const player = seasonStats.find(p => {
        const name = String(p?.Name || "").toLowerCase();
        const target = String(playerName || "").toLowerCase();
        return name.includes(target) || target.includes(name);
      });
      
      if (!player || !player.PlayerID) {
        console.log(`[getMLBPlayerGameLogs] Player not found: ${playerName} in season ${season}`);
        return [];
      }
      
      console.log(`[getMLBPlayerGameLogs] Found player: ${player.Name} (ID: ${player.PlayerID}) for season ${season}`);
      
      const gameLogs = await this._getWithCache(
        `/mlb/stats/json/PlayerGameStatsBySeason/${season}/${player.PlayerID}`,
        {},
        this.cacheTTL
      );
      
      if (!Array.isArray(gameLogs)) {
        console.log(`[getMLBPlayerGameLogs] No game logs returned for ${playerName}`);
        return [];
      }
      
      // Filter to only games where player actually pitched (had stats)
      const gamesPlayed = gameLogs.filter(g => {
        if (!g || !g.DateTime) return false;
        const ip = Number(g?.PitchingInningsPitchedDecimal) || Number(g?.InningsPitched) || 0;
        const outs = Number(g?.PitchingOuts) || 0;
        const bf = Number(g?.PitchingBattersFaced) || 0;
        return ip > 0 || outs > 0 || bf > 0;
      });
      
      console.log(`[getMLBPlayerGameLogs] Found ${gamesPlayed.length} games where ${playerName} pitched`);
      
      return gamesPlayed
        .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
        .slice(0, count);
    } catch (err) {
      console.warn("[SportsDataIOClient] getMLBPlayerGameLogs failed", err?.message || err);
      return [];
    }
  }

  async getNBAPlayerGameLogs(playerName, season = "2025", count = 15) {
    try {
      const seasonStats = await this.getNBAPlayerSeasonStats(season);
      if (!Array.isArray(seasonStats)) return [];
      
      const player = seasonStats.find(p => {
        const name = String(p?.Name || "").toLowerCase();
        const target = String(playerName || "").toLowerCase();
        return name.includes(target) || target.includes(name);
      });
      
      if (!player || !player.PlayerID) return [];
      
      const gameLogs = await this._getWithCache(
        `/nba/stats/json/PlayerGameStatsBySeason/${season}/${player.PlayerID}`,
        {},
        this.cacheTTL
      );
      
      if (!Array.isArray(gameLogs)) return [];
      
      // Filter to only games where player actually played
      const gamesPlayed = gameLogs.filter(g => {
        if (!g || !g.DateTime) return false;
        const minutes = Number(g?.Minutes) || 0;
        return minutes > 0;
      });
      
      return gamesPlayed
        .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime))
        .slice(0, count);
    } catch (err) {
      console.warn("[SportsDataIOClient] getNBAPlayerGameLogs failed", err?.message || err);
      return [];
    }
  }

  // ========== TEAM MATCHUP HISTORY (LAST 10 GAMES VS OPPONENT) ==========
  
  async getTeamMatchupHistory(sport, team, opponent, season = "2024", count = 10) {
    try {
      // This would need specific endpoints per sport
      // For now, placeholder that returns empty - implement when SportsData endpoints are confirmed
      console.warn("[SportsDataIOClient] getTeamMatchupHistory not yet implemented for", sport);
      return [];
    } catch (err) {
      console.warn("[SportsDataIOClient] getTeamMatchupHistory failed", err?.message || err);
      return [];
    }
  }

  // ========== NFL ==========
  
  getNFLSeasonCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentSeason`, {}, this.cacheTTL); }
  getNFLWeekCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentWeek`, {}, this.cacheTTL); }
  getNFLPlayerGameStatsByWeek(season, week) { return this._getWithCache(`/nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}`, {}, this.cacheTTL); }

  // ========== GAME ODDS (INTERNAL REFERENCE ONLY) ==========
  
  getMLBGameOdds(date) { return this._getWithCache(`/mlb/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNBAGameOdds(date) { return this._getWithCache(`/nba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAGameOdds(date) { return this._getWithCache(`/wnba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNFLGameOdds(week) { return this._getWithCache(`/nfl/odds/json/GameOddsByWeek/${week}`, {}, this.cacheTTL); }
}

// singleton
const defaultClient = new SportsDataIOClient({});
export const apiClient = defaultClient;
export { SportsDataIOClient as APIClient };
export default defaultClient;
