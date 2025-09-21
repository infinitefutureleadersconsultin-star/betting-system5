// /lib/clvTracker.js
// Closing Line Value (CLV) helper utilities.
// Always returns structured info to avoid null surprises.

/**
 * Convert American odds (e.g. +120, -110) to implied probability.
 */
function toImpliedProbability(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return -odds / (-odds + 100);
  }
}

/**
 * Compute CLV edge and structured info.
 * @param {number} openingOdds - odds when you placed the bet
 * @param {number} closingOdds - odds when market closed
 * @returns {object} structured clv info
 */
export function computeCLV(openingOdds, closingOdds) {
  const openProb = toImpliedProbability(openingOdds);
  const closeProb = toImpliedProbability(closingOdds);

  if (openProb == null || closeProb == null) {
    return {
      openingOdds,
      closingOdds,
      openProb,
      closeProb,
      edge: null,
      closingBetter: null,
    };
  }

  const edge = closeProb - openProb; // positive = beat the market
  const closingBetter = edge < 0 ? "worse" : edge > 0 ? "better" : "same";

  return {
    openingOdds,
    closingOdds,
    openProb,
    closeProb,
    edge,
    closingBetter,
  };
}
