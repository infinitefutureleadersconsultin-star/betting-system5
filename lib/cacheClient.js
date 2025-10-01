// lib/cacheClient.js
// Simple cache wrapper (in-memory + optional disk for Vercel /tmp)
// PRODUCTION OPTIMIZED: Added logging, /tmp support, better error handling

import fs from "fs";
import path from "path";

const mem = new Map();

// Use /tmp on Vercel/serverless (writable), or ./data/cache locally
const CACHE_DIR = process.env.VERCEL 
  ? path.join("/tmp", "cache")
  : path.join(process.cwd(), "data", "cache");

// Ensure cache dir exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`[cacheClient] Cache directory created: ${CACHE_DIR}`);
  }
} catch (err) {
  console.warn("[cacheClient] Cannot create cache dir:", err?.message);
}

function cacheFilename(key) {
  // Shorten filename for filesystem limits (max 255 chars)
  const hash = key.length > 100 
    ? Buffer.from(key).toString('base64').replace(/[/+=]/g, '_').slice(0, 100)
    : key.replace(/[/\\:*?"<>|]/g, '_');
  return path.join(CACHE_DIR, encodeURIComponent(hash) + ".json");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default {
  /**
   * Get cached value or fetch fresh data
   * @param {string} key - Cache key
   * @param {object} params - Additional parameters (used in composite key)
   * @param {number} ttlSeconds - Time to live in seconds (default from env or 3600)
   * @param {function} fetcher - Async function to fetch fresh data
   */
  async getOrFetch(key, params = {}, ttlSeconds = 3600, fetcher) {
    try {
      const compositeKey = typeof params === "string" || typeof params === "number"
        ? `${key}:${String(params)}`
        : `${key}:${JSON.stringify(params)}`;

      // Check memory cache first (fastest)
      const entry = mem.get(compositeKey);
      if (entry && entry.expiresAt > nowSec()) {
        console.log(`[cache HIT] ${compositeKey.slice(0, 80)}`);
        return entry.value;
      }

      // Try disk cache if memory miss
      try {
        const fn = cacheFilename(compositeKey);
        if (fs.existsSync(fn)) {
          const raw = fs.readFileSync(fn, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.expiresAt && parsed.expiresAt > nowSec()) {
            // Refresh memory cache from disk
            mem.set(compositeKey, { value: parsed.value, expiresAt: parsed.expiresAt });
            console.log(`[cache DISK HIT] ${compositeKey.slice(0, 80)}`);
            return parsed.value;
          }
        }
      } catch (err) {
        // Ignore disk errors silently (read-only filesystems, etc.)
      }

      // Fetch fresh data
      console.log(`[cache MISS] Fetching: ${compositeKey.slice(0, 80)}`);
      const value = await fetcher();
      if (value === undefined) return null;

      const expiresAt = nowSec() + Math.max(0, Number(ttlSeconds) || 3600);
      
      // Store in memory cache
      mem.set(compositeKey, { value, expiresAt });

      // Write to disk (best-effort, non-blocking)
      try {
        const fn = cacheFilename(compositeKey);
        fs.writeFileSync(fn, JSON.stringify({ value, expiresAt }), "utf8");
      } catch (err) {
        // Ignore write errors (serverless read-only filesystem outside /tmp)
      }

      return value;
    } catch (err) {
      console.warn("[cacheClient] getOrFetch error", err?.message || err);
      // Fallback: just run fetcher
      try {
        return await fetcher();
      } catch (e) {
        return null;
      }
    }
  },

  /**
   * Clear all caches (useful for testing/debugging)
   */
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

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memoryEntries: mem.size,
      cacheDir: CACHE_DIR,
      isVercel: !!process.env.VERCEL
    };
  }
};
