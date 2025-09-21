// /api/analyze-batch.js
import { runBatchAnalysis } from '../lib/engines/gameLinesEngine.js'
import axios from 'axios'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' })
  }

  try {
    const body = req.body
    const results = await runBatchAnalysis(body)

    // Post each pick to analytics
    const picks = [
      ...(results.props || []),
      ...(results.games || [])
    ]

    for (const pick of picks) {
      try {
        await axios.post(`${process.env.VERCEL_URL || ''}/api/analytics`, {
          gameId: pick.gameId || null,
          propId: pick.propId || null,
          pick: pick.decision || pick.recommendation,
          oddsAtPick: pick.odds || null,
          timestamp: new Date().toISOString()
        })
      } catch (err) {
        console.error('Analytics post failed (batch):', err.message)
      }
    }

    return res.status(200).json(results)
  } catch (err) {
    console.error('Batch analysis error:', err)
    return res.status(500).json({ message: 'Batch analysis failed.' })
  }
}
