// lib/middleware/usageTracker.js
// Monthly billing cycle usage tracking with Stripe integration

const usageStore = new Map(); // userId -> { count, periodStart, periodEnd, tier }

/**
 * Track usage per billing cycle (not daily)
 * Resets on subscription anniversary
 */
export async function trackUsage(userId, tier) {
  if (!userId) return { allowed: false, error: 'User ID required' };

  const limits = {
    basic: 100,
    pro: 400,
    admin: 10000
  };

  const limit = limits[tier];
  if (!limit) {
    return { allowed: false, error: 'Invalid tier' };
  }

  const now = Date.now();
  let usage = usageStore.get(userId);

  // Initialize or check if period expired
  if (!usage || now > usage.periodEnd) {
    // New billing cycle
    usage = {
      count: 0,
      periodStart: now,
      periodEnd: now + (30 * 24 * 60 * 60 * 1000), // 30 days
      tier
    };
    usageStore.set(userId, usage);
  }

  // Check limit
  if (usage.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: usage.periodEnd,
      limit,
      error: `Monthly limit reached (${limit} signals). Resets ${new Date(usage.periodEnd).toLocaleDateString()}`
    };
  }

  // Increment
  usage.count += 1;
  usageStore.set(userId, usage);

  return {
    allowed: true,
    remaining: limit - usage.count,
    resetAt: usage.periodEnd,
    limit,
    used: usage.count
  };
}

/**
 * Reset usage for a user (called by Stripe webhook on renewal)
 */
export async function resetUsage(userId) {
  usageStore.delete(userId);
  console.log(`[UsageTracker] Reset usage for user: ${userId}`);
}

/**
 * Get current usage for a user
 */
export function getUsage(userId) {
  const usage = usageStore.get(userId);
  if (!usage) return null;
  
  return {
    used: usage.count,
    limit: usage.tier === 'basic' ? 100 : usage.tier === 'pro' ? 400 : 10000,
    remaining: (usage.tier === 'basic' ? 100 : usage.tier === 'pro' ? 400 : 10000) - usage.count,
    resetAt: usage.periodEnd,
    periodStart: usage.periodStart
  };
}

export default { trackUsage, resetUsage, getUsage };
