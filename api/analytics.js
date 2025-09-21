// /api/analytics.js
import { computeClvEdge } from '../lib/clvTracker.js'
import { getClosingLine } from '../lib/apiClient.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  try {
    const { gameId, propId, pick, oddsAtPick, timestamp } = req.body

    if (!gameId && !propId) {
      return res.status(400).json({ message: 'Missing gameId or propId' })
    }

    // Pull closing odds from SportsDataIO (if game start is near or passed)
    let closingOdds = null
    let clvEdge = null

    try {
      closingOdds = await getClosingLine(gameId, propId)
      if (closingOdds && oddsAtPick) {
        clvEdge = computeClvEdge(oddsAtPick, closingOdds)
      }
    } catch (err) {
      console.error('CLV fetch failed:', err.message)
    }

    const logEntry = {
      gameId,
      propId,
      pick,
      oddsAtPick,
      closingOdds,
      clvEdge,
      timestamp: timestamp || new Date().toISOString()
    }

    // For now: log to console (later can push to DB / log service)
    console.log('Analytics Log:', JSON.stringify(logEntry, null, 2))

    return res.status(200).json({ status: 'ok', logEntry })
  } catch (err) {
    console.error('Analytics error:', err)
    return res.status(500).json({ message: 'Analytics logging failed.' })
  }
}
