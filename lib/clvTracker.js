// lib/clvTracker.js
//
// Simple helper to compute Closing Line Value (CLV).
// Compares odds at pick vs. closing odds and returns the edge.

function toImpliedProbability(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return -odds / (-odds + 100);
  }
}

/**
 * Compute CLV edge between opening odds and closing odds.
 *
 * @param {number} openingOdds - odds at time of pick (e.g. +120, -110)
 * @param {number} closingOdds - closing line odds
 * @returns {object} clv info
 */
export function computeCLV(openingOdds, closingOdds) {
  const openProb = toImpliedProbability(openingOdds);
  const closeProb = toImpliedProbability(closingOdds);

  if (openProb == null || closeProb == null) {
    return { edge: null, openProb, closeProb, closingBetter: null };
  }

  const edge = closeProb - openProb; // positive means you beat the market
  const closingBetter = edge < 0 ? "worse" : (edge > 0 ? "better" : "same");

  return {
    openingOdds,
    closingOdds,
    openProb,
    closeProb,
    edge,
    closingBetter,
  };
}
