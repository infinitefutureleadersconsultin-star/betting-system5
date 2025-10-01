// lib/cacheClient.js
// Simple cache wrapper (in-memory + optional disk for Vercel /tmp)
// PRODUCTION OPTIMIZED: Added logging, /tmp support, better error handling

import fs from "fs";
import path from "path";

const mem = new Map();

const CACHE_DIR = process.env.VERCEL 
  ? path.join("/tmp", "cache")
  : path.join(process.cwd(), "data", "cache");

try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`[cacheClient] Cache directory created: ${CACHE_DIR}`);
  }
} catch (err) {
  console.warn("[cacheClient] Cannot create cache dir:", err?.message);
}

function cacheFilename(key) {
  const hash = key.length > 100 
    ? Buffer.from(key).toString('base64').replace(/[/+=]/g, '_').slice(0, 100)
    : key.replace(/[/\\:*?"<>|]/g, '_');
  return path.join(CACHE_DIR, encodeURIComponent(hash) + ".json");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default {
  async getOrFetch(key, params = {}, ttlSeconds = 3600, fetcher) {
    try {
      const compositeKey = typeof params === "string" || typeof params === "number"
        ? `${key}:${String(params)}`
        : `${key}:${JSON.stringify(params)}`;

      const entry = mem.get(compositeKey);
      if (entry && entry.expiresAt > nowSec()) {
        console.log(`[cache HIT] ${compositeKey.slice(0, 80)}`);
        return entry.value;
      }

      try {
        const fn = cacheFilename(compositeKey);
        if (fs.existsSync(fn)) {
          const raw = fs.readFileSync(fn, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.expiresAt && parsed.expiresAt > nowSec()) {
            mem.set(compositeKey, { value: parsed.value, expiresAt: parsed.expiresAt });
            console.log(`[cache DISK HIT] ${compositeKey.slice(0, 80)}`);
            return parsed.value;
          }
        }
      } catch (err) {
        // Ignore disk errors silently
      }

      console.log(`[cache MISS] Fetching: ${compositeKey.slice(0, 80)}`);
      const value = await fetcher();
      if (value === undefined) return null;

      const expiresAt = nowSec() + Math.max(0, Number(ttlSeconds) || 3600);
      
      mem.set(compositeKey, { value, expiresAt });

      try {
        const fn = cacheFilename(compositeKey);
        fs.writeFileSync(fn, JSON.stringify({ value, expiresAt }), "utf8");
      } catch (err) {
        // Ignore write errors
      }

      return value;
    } catch (err) {
      console.warn("[cacheClient] getOrFetch error", err?.message || err);
      try {
        return await fetcher();
      } catch (e) {
        return null;
      }
    }
  },

  clear() {
    mem.clear();
    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
      console.log("[cacheClient] All caches cleared");
    } catch (err) {
      console.warn("[cacheClient] Clear cache failed:", err?.message);
    }
  },

  getStats() {
    return {
      memoryEntries: mem.size,
      cacheDir: CACHE_DIR,
      isVercel: !!process.env.VERCEL
    };
  }
};
