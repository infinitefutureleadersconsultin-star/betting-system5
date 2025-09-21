// /lib/apiClient.js
// SportsDataIO API Client — lean, explicit, CLV-ready, and compatible with engines

import fetch from "node-fetch";

export class SportsDataIOClient {
  constructor({ apiKey }) {
    this.apiKey = (apiKey || "").trim();
    this.baseURL = "https://api.sportsdata.io/v3";
    this.lastHttp = null;
  }

  // Generic GET with error handling
  async get(path) {
    const url = `${this.baseURL}${path}`;
    try {
      const resp = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
      });
      this.lastHttp = { status: resp.status, url };

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status} ${url}: ${text}`);
      }

      return await resp.json();
    } catch (err) {
      console.error("[SportsDataIOClient] GET failed", { url, error: err.message });
      throw err;
    }
  }

  // --- Closing Line Odds Helper (for CLV tracking) ---
  async getClosingLine(gameId, propId = null) {
    try {
      if (propId) {
        const data = await this.get(`/odds/json/PlayerProp/${propId}`);
        return typeof data?.ClosingLine === "number" ? data.ClosingLine : null;
      } else if (gameId) {
        const data = await this.get(`/odds/json/Game/${gameId}`);
        return typeof data?.ClosingLine === "number" ? data.ClosingLine : null;
      }
      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getClosingLine failed", err.message);
      return null;
    }
  }

  // --- Season Stats ---
  getMLBPlayerSeasonStats(season) {
    return this.get(`/mlb/stats/json/PlayerSeasonStats/${season}`);
  }
  getNBAPlayerSeasonStats(season) {
    return this.get(`/nba/stats/json/PlayerSeasonStats/${season}`);
  }
  getWNBAPlayerSeasonStats(season) {
    return this.get(`/wnba/stats/json/PlayerSeasonStats/${season}`);
  }
  getNFLPlayerSeasonStats(season) {
    return this.get(`/nfl/stats/json/PlayerSeasonStats/${season}`);
  }

  // --- By-Date (per-game) Stats ---
  getMLBPlayerStatsByDate(date) {
    return this.get(`/mlb/stats/json/PlayerGameStatsByDate/${date}`);
  }
  getNBAPlayerStatsByDate(date) {
    return this.get(`/nba/stats/json/PlayerGameStatsByDate/${date}`);
  }
  getWNBAPlayerStatsByDate(date) {
    return this.get(`/wnba/stats/json/PlayerGameStatsByDate/${date}`);
  }

  // --- NFL Helpers ---
  getNFLSeasonCurrent() {
    return this.get(`/nfl/scores/json/CurrentSeason`);
  }
  getNFLWeekCurrent() {
    return this.get(`/nfl/scores/json/CurrentWeek`);
  }
  getNFLPlayerGameStatsByWeek(season, week) {
    return this.get(`/nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}`);
  }

  // --- Odds Endpoints ---
  getMLBGameOdds(date) {
    return this.get(`/mlb/odds/json/GameOddsByDate/${date}`);
  }
  getNBAGameOdds(date) {
    return this.get(`/nba/odds/json/GameOddsByDate/${date}`);
  }
  getWNBAGameOdds(date) {
    return this.get(`/wnba/odds/json/GameOddsByDate/${date}`);
  }
  getNFLGameOdds(week) {
    return this.get(`/nfl/odds/json/GameOddsByWeek/${week}`);
  }
}

// ✅ Singleton instance (shared globally)
export const apiClient = new SportsDataIOClient({
  apiKey:
    process.env.SPORTS_DATA_IO_KEY ||
    process.env.SPORTS_DATA_IO_API_KEY ||
    process.env.SPORTSDATAIO_KEY ||
    process.env.SDIO_KEY ||
    process.env.SPORTSDATA_API_KEY ||
    process.env.SPORTS_DATA_API_KEY ||
    process.env.SPORTS_DATA_KEY ||
    "",
});

export { SportsDataIOClient as APIClient };
export default apiClient;
