// api/admin/public-stats.js
// Public-facing aggregate model performance stats

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // In production, fetch from database
  // For now, return mock data that admin manually updates
  const stats = {
    nbaAccuracy: 62,
    mlbAccuracy: 58,
    nflAccuracy: 65,
    wnbaAccuracy: 60,
    totalAnalyzed: 847,
    topPick: "Lakers ML (-150)",
    lastUpdated: new Date().toISOString()
  };

  res.status(200).json(stats);
}
