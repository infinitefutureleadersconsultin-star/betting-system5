// lib/apiClient.js
export class SportsDataIOClient {
  constructor(opts = {}) {
    this.apiKey =
      (opts.apiKey || "").trim() ||
      (process.env.SPORTS_DATA_IO_KEY || "").trim() ||
      (process.env.SPORTS_DATA_IO_API_KEY || "").trim() ||
      (process.env.SPORTSDATAIO_KEY || "").trim() ||
      (process.env.SDIO_KEY || "").trim() ||
      (process.env.SPORTSDATA_API_KEY || "").trim() ||
      (process.env.SPORTS_DATA_API_KEY || "").trim() ||
      (process.env.SPORTS_DATA_KEY || "").trim() ||
      "";

    this.baseURL = (
      opts.baseURL ||
      process.env.SPORTS_DATA_IO_BASEURL ||
      "https://api.sportsdata.io"
    ).replace(/\/+$/, "");

    this.rateLimitDelay = Number(opts.rateLimitDelay ?? process.env.SPORTS_DATA_IO_RATE_DELAY ?? 250);
    this.lastRequestTime = 0;
    this.lastHttp = null;
  }

  setApiKey(key) { this.apiKey = (key || "").trim(); }
  setBaseURL(url) { if (url) this.baseURL = url.replace(/\/+$/, ""); }

  async makeRequest(endpoint, params = {}) {
    if (!this.apiKey) {
      this.lastHttp = null;
      return {};
    }

    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - elapsed));
    }

    const ep = endpoint.startsWith("/") ? endpoint : (`/${endpoint}`);
    const url = new URL(this.baseURL + ep);
    url.searchParams.set("key", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    this.lastRequestTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      console.log("[SportsDataIO] GET", url.toString());
      const resp = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      clearTimeout(timeout);

      this.lastHttp = { status: resp.status, ok: resp.ok, url: url.toString() };

      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 750));
        const resp2 = await fetch(url.toString(), { headers: { Accept: "application/json" } }).catch(()=>null);
        if (!resp2) return {};
        this.lastHttp = { status: resp2.status, ok: resp2.ok, url: url.toString() };
        if (!resp2.ok) return {};
        try { return await resp2.json(); } catch { return {}; }
      }

      if (!resp.ok) return {};
      try { return await resp.json(); } catch { return {}; }
    } catch (e) {
      clearTimeout(timeout);
      this.lastHttp = { status: null, ok: false, url: url.toString(), err: String(e) };
      return {};
    }
  }

  // Season stats
  async getMLBPlayerSeasonStats(season){
    return this.makeRequest(`/v3/mlb/stats/json/PlayerSeasonStats/${season}`);
  }
  async getNBAPlayerSeasonStats(season){
    return this.makeRequest(`/v3/nba/stats/json/PlayerSeasonStats/${season}`);
  }
  async getWNBAPlayerSeasonStats(season){
    return this.makeRequest(`/v3/wnba/stats/json/PlayerSeasonStats/${season}`);
  }
  async getNFLPlayerSeasonStats(season){
    return this.makeRequest(`/v3/nfl/stats/json/PlayerSeasonStats/${season}`);
  }

  // By-date (per-game) stats
  async getMLBPlayerStatsByDate(date){
    return this.makeRequest(`/v3/mlb/stats/json/PlayerGameStatsByDate/${date}`);
  }
  async getNBAPlayerStatsByDate(date){
    return this.makeRequest(`/v3/nba/stats/json/PlayerGameStatsByDate/${date}`);
  }
  async getWNBAPlayerStatsByDate(date){
    return this.makeRequest(`/v3/wnba/stats/json/PlayerGameStatsByDate/${date}`);
  }

  // NFL week helpers
  async getNFLSeasonCurrent(){
    return this.makeRequest(`/v3/nfl/scores/json/CurrentSeason`);
  }
  async getNFLWeekCurrent(){
    return this.makeRequest(`/v3/nfl/scores/json/CurrentWeek`);
  }
  async getNFLPlayerGameStatsByWeek(season, week){
    return this.makeRequest(`/v3/nfl/stats/json/PlayerGameStatsByWeek/${season}/${week}`);
  }

  // Optional odds endpoints
  async getMLBGameOdds(date) { return this.makeRequest(`/v3/mlb/odds/json/GameOddsByDate/${date}`); }
  async getNBAGameOdds(date) { return this.makeRequest(`/v3/nba/odds/json/GameOddsByDate/${date}`); }
  async getWNBAGameOdds(date) { return this.makeRequest(`/v3/wnba/odds/json/GameOddsByDate/${date}`); }
  async getNFLGameOdds(week) { return this.makeRequest(`/v3/nfl/odds/json/GameOddsByWeek/${week}`); }
}

const singleton = new SportsDataIOClient();
export const apiClient = singleton;
export { SportsDataIOClient as APIClient };
export default singleton;
