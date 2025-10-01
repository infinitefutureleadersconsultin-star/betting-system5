// lib/middleware/rateLimiter.js
// Rate limiter - 1 device, paid tiers only

import Redis from 'ioredis';

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
const inMemoryStore = new Map();

const RATE_LIMITS = {
  basic: {
    requests: 100,
    windowMs: 86400000,
    label: "Basic ($15/mo)"
  },
  pro: {
    requests: 500,
    windowMs: 86400000,
    label: "Pro ($40/mo)"
  },
  admin: {
    requests: 10000,
    windowMs: 86400000,
    label: "Admin"
  }
};

async function getRateLimitData(userId) {
  const key = `ratelimit:${userId}`;
  
  if (redis) {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.warn('[rateLimiter] Redis get failed:', err.message);
      return inMemoryStore.get(key) || null;
    }
  }
  
  return inMemoryStore.get(key) || null;
}

async function setRateLimitData(userId, data, ttlMs) {
  const key = `ratelimit:${userId}`;
  
  if (redis) {
    try {
      await redis.setex(key, Math.ceil(ttlMs / 1000), JSON.stringify(data));
    } catch (err) {
      console.warn('[rateLimiter] Redis set failed:', err.message);
      inMemoryStore.set(key, data);
    }
  } else {
    inMemoryStore.set(key, data);
  }
}

export async function checkRateLimit(userId, tier) {
  try {
    if (!userId) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now(),
        error: 'User ID required'
      };
    }

    const limit = RATE_LIMITS[tier];
    
    if (!limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now(),
        error: 'Valid subscription required'
      };
    }
    
    const now = Date.now();
    let data = await getRateLimitData(userId);
    
    if (!data || now > data.resetAt) {
      data = {
        count: 0,
        resetAt: now + limit.windowMs,
        tier: tier
      };
    }
    
    if (data.count >= limit.requests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: data.resetAt,
        limit: limit.requests,
        tier: limit.label,
        error: `Rate limit exceeded. Resets ${new Date(data.resetAt).toLocaleString()}`
      };
    }
    
    data.count += 1;
    await setRateLimitData(userId, data, data.resetAt - now);
    
    return {
      allowed: true,
      remaining: limit.requests - data.count,
      resetAt: data.resetAt,
      limit: limit.requests,
      tier: limit.label
    };
    
  } catch (err) {
    console.error('[rateLimiter] Error:', err);
    return {
      allowed: true,
      remaining: 999,
      resetAt: Date.now() + 86400000,
      error: 'Rate limiter degraded, allowing request'
    };
  }
}

export function rateLimitMiddleware(req, res, next) {
  const userId = req.user?.id;
  const tier = req.user?.tier;
  
  if (!userId || !tier) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  checkRateLimit(userId, tier)
    .then(result => {
      res.setHeader('X-RateLimit-Limit', result.limit || 0);
      res.setHeader('X-RateLimit-Remaining', result.remaining || 0);
      res.setHeader('X-RateLimit-Reset', result.resetAt || Date.now());
      
      if (!result.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: result.error,
          resetAt: result.resetAt,
          tier: result.tier
        });
      }
      
      req.rateLimit = result;
      next();
    })
    .catch(err => {
      console.error('[rateLimitMiddleware] Error:', err);
      next();
    });
}
