// lib/apiClient.js
// SportsDataIO API Client — primary: SportsDataIO with local cache (Option B).
// Fallback odds source via OddsAPI (only used if SDIO returns no odds)

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

  // Closing Line
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
  // Note: OddsAPI returns decimal odds depending on query; we normalize to decimals.
  async getOddsFromOddsAPI({ sport, date }) {
    if (!this.oddsApiKey) return null;
    try {
      const base = "https://api.the-odds-api.com/v4";
      // Map our sport to OddsAPI sport keys (basic mapping)
      const sportKeyMap = { MLB: "baseball_mlb", NBA: "basketball_nba", WNBA: "basketball_wnba", NFL: "americanfootball_nfl" };
      const key = sportKeyMap[sport] || null;
      if (!key) return null;
      // TheOddsAPI expects region & market - we'll request US & h2h/markets.
      const url = new URL(`${base}/sports/${key}/odds`);
      if (date) url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("regions", "us");
      url.searchParams.set("markets", "h2h,spreads");
      url.searchParams.set("apiKey", this.oddsApiKey);
      // date param for some endpoints can be passed as 'oddsDate' but we'll just call and filter by date when parsing
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
