// api/props/evaluate.js
// Main endpoint for evaluating player props - now with monthly usage tracking

import { authMiddleware } from '../../lib/middleware/auth.js';
import { trackUsage } from '../../lib/middleware/usageTracker.js';
import { storeUserQuery } from '../user/confidence-history.js';
import { PlayerPropsEngine } from '../../lib/engines/playerPropsEngine.js';
import { apiClient } from '../../lib/apiClient.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  await new Promise((resolve, reject) => {
    authMiddleware(req, res, (err) => err ? reject(err) : resolve());
  });

  // Check monthly usage limit
  const usageCheck = await trackUsage(req.user.id, req.user.tier);
  
  if (!usageCheck.allowed) {
    return res.status(429).json({
      error: 'Monthly signal limit reached',
      message: usageCheck.error,
      remaining: 0,
      resetAt: usageCheck.resetAt,
      limit: usageCheck.limit
    });
  }

  try {
    const { sport, player, prop, startTime, currentPrice } = req.body;

    if (!sport || !player || !prop) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['sport', 'player', 'prop'],
        example: {
          sport: 'NBA',
          player: 'LeBron James',
          prop: 'Points 25.5',
          startTime: '2025-10-15T19:00:00Z',
          currentPrice: -110
        }
      });
    }

    const engine = new PlayerPropsEngine(apiClient);
    
    const result = await engine.evaluateProp({
      sport,
      player,
      prop,
      startTime,
      currentPrice
    });

    // Store query in user history (confidence scores only, no outcomes)
    storeUserQuery(req.user.id, {
      player,
      prop,
      sport,
      confidence: result.finalConfidence || result.confidence,
      decision: result.decision,
      clv: result.clv
    });

    return res.status(200).json({
      success: true,
      result,
      user: {
        id: req.user.id,
        tier: req.user.tier,
        queriesRemaining: usageCheck.remaining,
        resetAt: usageCheck.resetAt,
        limit: usageCheck.limit,
        used: usageCheck.used
      }
    });
  } catch (err) {
    console.error('[Evaluate Prop] Error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
}
