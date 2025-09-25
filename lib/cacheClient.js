// lib/cacheClient.js
// Simple cache wrapper (in-memory + optional disk fallback)
// Intended for dev / Vercel serverless usage (short TTL).
// If you run on server with write access, it will persist to ./data/cache/

import fs from "fs";
import path from "path";

const mem = new Map();
const CACHE_DIR = path.join(process.cwd(), "data", "cache");

// ensure cache dir exists if running in an environment with writable FS
try {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (err) {
  // Ignore: serverless may not allow writes; that's fine — mem cache still works.
}

function cacheFilename(key) {
  return path.join(CACHE_DIR, encodeURIComponent(key) + ".json");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default {
  async getOrFetch(key, params = {}, ttlSeconds = 60, fetcher) {
    try {
      const compositeKey = typeof params === "string" || typeof params === "number"
        ? `${key}:${String(params)}`
        : `${key}:${JSON.stringify(params)}`;

      const entry = mem.get(compositeKey);
      if (entry && entry.expiresAt > nowSec()) {
        return entry.value;
      }

      // Try disk if available
      try {
        const fn = cacheFilename(compositeKey);
        if (fs.existsSync(fn)) {
          const raw = fs.readFileSync(fn, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.expiresAt && parsed.expiresAt > nowSec()) {
            // refresh mem
            mem.set(compositeKey, { value: parsed.value, expiresAt: parsed.expiresAt });
            return parsed.value;
          }
        }
      } catch (err) {
        // ignore disk errors
      }

      // fetch fresh
      const value = await fetcher();
      if (value === undefined) return null;

      const expiresAt = nowSec() + Math.max(0, Number(ttlSeconds) || 60);
      mem.set(compositeKey, { value, expiresAt });

      // write disk (best-effort)
      try {
        const fn = cacheFilename(compositeKey);
        fs.writeFileSync(fn, JSON.stringify({ value, expiresAt }), "utf8");
      } catch (err) {
        // ignore write errors
      }

      return value;
    } catch (err) {
      console.warn("[cacheClient] getOrFetch error", err?.message || err);
      // fallback: just run fetcher
      try {
        const v = await fetcher();
        return v;
      } catch (e) {
        return null;
      }
    }
  }
};
