// lib/apiClient.js
// SportsDataIO API Client — lean, explicit, CLV-ready, uses local cacheClient.js (Option B)

import fetch from "node-fetch";
import cacheClient from "./cacheClient.js";

/**
 * Resolve API key from common environment variable names.
 * You can still pass { apiKey: '...' } into constructor to override.
 */
function resolveEnvApiKey() {
  const names = [
    "SPORTS_DATA_IO_KEY",
    "SPORTS_DATA_IO_API_KEY",
    "SPORTSDATAIO_KEY",
    "SDIO_KEY",
    "SPORTSDATA_API_KEY",
    "SPORTS_DATA_API_KEY",
    "SPORTS_DATA_KEY",
    "SPORTSDATA_API_KEY" // fallback
  ];
  for (const n of names) {
    if (process.env[n] && String(process.env[n]).trim() !== "") return String(process.env[n]).trim();
  }
  return "";
}

export class SportsDataIOClient {
  constructor(opts = {}) {
    this.apiKey = (opts.apiKey || "").trim() || resolveEnvApiKey();
    this.baseURL = (opts.baseURL || process.env.SPORTSDATA_BASEURL || "https://api.sportsdata.io/v3").replace(/\/+$/, "");
    this.cacheTTL = Number(opts.cacheTTL || process.env.SPORTSDATA_CACHE_TTL || 86400); // seconds
    this.lastHttp = null;
  }

  setApiKey(key) { this.apiKey = (key || "").trim(); }
  setBaseURL(url) { if (url) this.baseURL = String(url).replace(/\/+$/, ""); }

  async _getWithCache(path, params = {}, ttlSeconds = this.cacheTTL) {
    // key: path + params serialized
    const cacheKey = path;
    const cacheParams = params;
    return await cacheClient.getOrFetch(cacheKey, cacheParams, ttlSeconds, async () => {
      // Build URL
      const url = new URL(this.baseURL + path);
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }

      try {
        const resp = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "Ocp-Apim-Subscription-Key": this.apiKey
          },
          // don't set timeout here (serverless handles)
        });
        this.lastHttp = { status: resp.status, ok: resp.ok, url: url.toString() };

        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          console.warn(`[SportsDataIOClient] non-200 ${resp.status} ${url}: ${txt}`);
          return null;
        }
        const json = await resp.json().catch(() => null);
        return json;
      } catch (err) {
        console.warn("[SportsDataIOClient] fetch error", err?.message || err);
        return null;
      }
    });
  }

  // --- Closing Line Odds Helper (for CLV tracking) ---
  async getClosingLine(gameId, propId = null) {
    try {
      if (propId) {
        // Player prop closing odds: endpoint paths vary by provider version.
        // Try a couple possibilities; if none return a number, return null.
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
        // Game-level closing line endpoints
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

  // --- Season stats ---
  getMLBPlayerSeasonStats(season) { return this._getWithCache(`/mlb/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNBAPlayerSeasonStats(season) { return this._getWithCache(`/nba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getWNBAPlayerSeasonStats(season) { return this._getWithCache(`/wnba/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }
  getNFLPlayerSeasonStats(season) { return this._getWithCache(`/nfl/stats/json/PlayerSeasonStats/${season}`, {}, this.cacheTTL); }

  // --- By-date (per-game) stats ---
  getMLBPlayerStatsByDate(date) { return this._getWithCache(`/mlb/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getNBAPlayerStatsByDate(date) { return this._getWithCache(`/nba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAPlayerStatsByDate(date) { return this._getWithCache(`/wnba/stats/json/PlayerGameStatsByDate/${date}`, {}, this.cacheTTL); }

  // --- NFL helpers ---
  getNFLSeasonCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentSeason`, {}, this.cacheTTL); }
  getNFLWeekCurrent() { return this._getWithCache(`/nfl/scores/json/CurrentWeek`, {}, this.cacheTTL); }
  getNFLPlayerGameStatsByWeek(season, week) { return this._getWithCache(`/nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}`, {}, this.cacheTTL); }

  // --- Odds endpoints ---
  getMLBGameOdds(date) { return this._getWithCache(`/mlb/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNBAGameOdds(date) { return this._getWithCache(`/nba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getWNBAGameOdds(date) { return this._getWithCache(`/wnba/odds/json/GameOddsByDate/${date}`, {}, this.cacheTTL); }
  getNFLGameOdds(week) { return this._getWithCache(`/nfl/odds/json/GameOddsByWeek/${week}`, {}, this.cacheTTL); }
}

// singleton convenience
const defaultClient = new SportsDataIOClient({});
export const apiClient = defaultClient;
export { SportsDataIOClient as APIClient };
export default defaultClient;
