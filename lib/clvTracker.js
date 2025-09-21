// /lib/clvTracker.js
// Utility to compute Closing Line Value (CLV)

function oddsToDecimal(odds) {
  if (typeof odds !== 'number') return null
  return odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1
}

function decimalToImpliedProb(decimalOdds) {
  if (!decimalOdds) return null
  return 1 / decimalOdds
}

function computeClvEdge(openingOdds, closingOdds) {
  const openDec = oddsToDecimal(openingOdds)
  const closeDec = oddsToDecimal(closingOdds)

  if (!openDec || !closeDec) return null

  const openProb = decimalToImpliedProb(openDec)
  const closeProb = decimalToImpliedProb(closeDec)

  return closeProb - openProb
}

module.exports = {
  oddsToDecimal,
  decimalToImpliedProb,
  computeClvEdge
}
