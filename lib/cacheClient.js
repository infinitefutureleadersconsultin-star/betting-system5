// lib/cacheClient.js
// Simple JSON-file cache used by apiClient (Option B).
// - TTL per entry
// - In-memory warm
// - Best-effort safe writes (tmp -> rename)
// - Non-throwing on disk errors (won't crash serverless)

import fs from "fs/promises";
import path from "path";

const DEFAULT_CACHE_FILE = process.env.SPORTSDATA_CACHE_FILE || path.join(process.cwd(), "data", "sportsdata_cache.json");
const DEFAULT_TTL_SECONDS = Number(process.env.SPORTSDATA_CACHE_TTL || 86400); // 24h default

class CacheClient {
  constructor(filePath = DEFAULT_CACHE_FILE, defaultTTL = DEFAULT_TTL_SECONDS) {
    this.filePath = filePath;
    this.defaultTTL = Number(defaultTTL) || DEFAULT_TTL_SECONDS;
    this.store = { meta: { createdAt: Date.now() }, entries: {} };
    this._loaded = false;
    this._saving = false;
  }

  async _ensureDir() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  async _loadIfNeeded() {
    if (this._loaded) return;
    try {
      const txt = await fs.readFile(this.filePath, "utf8");
      this.store = JSON.parse(txt);
      if (!this.store || typeof this.store !== "object" || !this.store.entries) {
        this.store = { meta: { createdAt: Date.now() }, entries: {} };
      }
    } catch (e) {
      // file missing or parse error -> start fresh
      this.store = { meta: { createdAt: Date.now() }, entries: {} };
    }
    this._loaded = true;
  }

  _makeKey(key, params) {
    // deterministic key for a path + params object
    const paramsStr = params && Object.keys(params).length ? JSON.stringify(params) : "";
    return `${key}::${paramsStr}`;
  }

  async get(key, params = {}) {
    await this._loadIfNeeded();
    const k = this._makeKey(key, params);
    const entry = this.store.entries[k];
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // expired: delete and schedule save
      delete this.store.entries[k];
      this._saveNoWait();
      return null;
    }
    return entry.value;
  }

  async set(key, params = {}, value, ttlSeconds = this.defaultTTL) {
    try {
      await this._loadIfNeeded();
      const k = this._makeKey(key, params);
      const now = Date.now();
      this.store.entries[k] = {
        value,
        storedAt: now,
        expiresAt: ttlSeconds > 0 ? now + ttlSeconds * 1000 : null,
      };
      this._saveNoWait();
    } catch (e) {
      // swallow disk errors
      console.warn("[cacheClient] set failed (non-fatal)", e?.message || e);
    }
  }

  async getOrFetch(key, params = {}, ttlSeconds = this.defaultTTL, fetchFn) {
    // If cached and valid -> return. Else call fetchFn() to get fresh, cache and return.
    try {
      const cached = await this.get(key, params);
      if (cached !== null && cached !== undefined) return cached;
      const fresh = await fetchFn();
      // Only cache JSON-serializable results (we try to serialize here)
      try {
        // guard: if fresh is undefined or null, still store to avoid repeat warm hits? We store only non-null
        if (fresh !== undefined && fresh !== null) {
          await this.set(key, params, fresh, ttlSeconds);
        }
      } catch (e) {
        // ignore set errors
      }
      return fresh;
    } catch (e) {
      // If something goes wrong, fallback to fetchFn directly
      try {
        return await fetchFn();
      } catch (err) {
        console.warn("[cacheClient] getOrFetch fallback fetchFn error", err?.message || err);
        return null;
      }
    }
  }

  _saveNoWait() {
    if (this._saving) return;
    this._saving = true;
    // fire-and-forget save, but we handle errors
    (async () => {
      try {
        await this._ensureDir();
        const tmp = this.filePath + ".tmp";
        await fs.writeFile(tmp, JSON.stringify(this.store, null, 2), "utf8");
        await fs.rename(tmp, this.filePath);
      } catch (e) {
        // don't throw; just log
        console.warn("[cacheClient] save failed (non-fatal)", e?.message || e);
      } finally {
        this._saving = false;
      }
    })();
  }
}

const singleton = new CacheClient();
export default singleton;
export { CacheClient };
