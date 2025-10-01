// api/props/evaluate.js
// Main endpoint for evaluating player props

import { authMiddleware } from '../../lib/middleware/auth.js';
import { rateLimitMiddleware } from '../../lib/middleware/rateLimiter.js';
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

  // Rate limit check
  await new Promise((resolve, reject) => {
    rateLimitMiddleware(req, res, (err) => err ? reject(err) : resolve());
  });

  try {
    const { sport, player, prop, startTime, currentPrice } = req.body;

    if (!sport || !player || !prop) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['sport', 'player', 'prop']
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

    return res.status(200).json({
      success: true,
      result,
      user: {
        id: req.user.id,
        tier: req.user.tier,
        queriesRemaining: req.rateLimit.remaining
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
