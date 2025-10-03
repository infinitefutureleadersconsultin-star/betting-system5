// api/user/confidence-history.js
// Endpoint to fetch user's query history (confidence scores only, no gambling outcomes)

import { authMiddleware } from '../../lib/middleware/auth.js';

// In-memory store (replace with database in production)
const userHistoryStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  await new Promise((resolve, reject) => {
    authMiddleware(req, res, (err) => err ? reject(err) : resolve());
  });

  try {
    const userId = req.user.id;
    const history = userHistoryStore.get(userId) || [];

    return res.status(200).json({
      success: true,
      history: history.map(item => ({
        player: item.player,
        prop: item.prop,
        sport: item.sport,
        confidence: item.confidence,
        decision: item.decision,
        timestamp: item.timestamp,
        clv: item.clv || null
      }))
    });
  } catch (err) {
    console.error('[Confidence History] Error:', err);
    return res.status(500).json({
      error: 'Failed to fetch history',
      message: err.message
    });
  }
}

// Helper function to store query (called from evaluate.js)
export function storeUserQuery(userId, queryData) {
  if (!userHistoryStore.has(userId)) {
    userHistoryStore.set(userId, []);
  }

  const history = userHistoryStore.get(userId);
  history.unshift({
    player: queryData.player,
    prop: queryData.prop,
    sport: queryData.sport,
    confidence: queryData.confidence,
    decision: queryData.decision,
    clv: queryData.clv,
    timestamp: new Date().toISOString()
  });

  // Keep only last 100 queries
  if (history.length > 100) {
    history.pop();
  }

  userHistoryStore.set(userId, history);
}
