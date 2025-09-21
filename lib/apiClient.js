// /lib/apiClient.js
// SportsDataIO API Client with flexible key + closing line helper

import fetch from "node-fetch";

export class SportsDataIOClient {
  constructor({ apiKey }) {
    this.apiKey = apiKey;
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
      console.error("[SportsDataIOClient] get failed", { url, error: err.message });
      throw err;
    }
  }

  /**
   * Fetch closing line odds for a game or prop.
   * For props, you may need to supply both gameId + propId.
   * Returns American odds (number) or null if unavailable.
   */
  async getClosingLine(gameId, propId = null) {
    try {
      if (propId) {
        // Example: player prop closing line endpoint
        const data = await this.get(`/odds/json/PlayerProp/${propId}`);
        return typeof data?.ClosingLine === "number" ? data.ClosingLine : null;
      } else if (gameId) {
        // Example: game odds endpoint
        const data = await this.get(`/odds/json/Game/${gameId}`);
        return typeof data?.ClosingLine === "number" ? data.ClosingLine : null;
      }
      return null;
    } catch (err) {
      console.warn("[SportsDataIOClient] getClosingLine failed", err.message);
      return null;
    }
  }
}

// Simple global instance (if you prefer not to re-init everywhere)
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
