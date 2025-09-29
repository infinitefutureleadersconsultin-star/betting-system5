// lib/statisticalModels.js
// Statistical probability calculators and baseline estimators for sports props

function erf(x) {
  // Abramowitz–Stegun approximation
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
        a2 = -0.284496736,
        a3 = 1.421413741,
        a4 = -1.453152027,
        a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t) + a3) * t + a2) * t * a1 * t * Math.exp(-x * x);
  return sign * y;
}

function normalCCDF(x, mu = 0, sigma = 1) {
  if (!(sigma > 0)) sigma = 1;
  const z = (x - mu) / (sigma * Math.SQRT2);
  return 0.5 * (1 - erf(z));
}

function factorial(n) {
  if (n < 0) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonCDF(k, lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return k >= 0 ? 1 : 0;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += Math.pow(lambda, i) / factorial(i);
  }
  return Math.exp(-lambda) * sum;
}

export const StatisticalModels = {
  /**
   * Calculate probability of exceeding a line using Poisson distribution
   * P(X > line) with a 0.5 continuity correction: P(X >= ceil(line+ε))
   */
  calculatePoissonProbability(mu, line) {
    if (!Number.isFinite(mu) || mu <= 0) return 0.5;
    const thr = Math.floor(line + 0.5); // continuity-ish
    const cdf = poissonCDF(thr, Math.max(0, mu));
    const pOver = 1 - cdf;
    return Math.max(0, Math.min(1, pOver));
  },

  /**
   * Calculate probability of exceeding a line using Normal distribution
   * P(X > line) using Normal tail with 0.5 continuity correction
   */
  calculateNormalProbability(mu, sigma, line) {
    if (!Number.isFinite(mu)) return 0.5;
    if (!(sigma > 0)) sigma = 1;
    const x = line + 0.5;
    return Math.max(0, Math.min(1, normalCCDF(x, mu, sigma)));
  },

  /**
   * Get baseline/fallback value for a given sport and prop type
   * Used when no player-specific data is available
   * @param {string} sport - Sport code (NBA, WNBA, MLB, NFL)
   * @param {string} prop - Prop description (e.g., "Points 23.5", "Rebounds", "Strikeouts 6.5")
   * @returns {number|null} Baseline value or null if no baseline available
   */
  getBaseline(sport, prop) {
    try {
      const sportUpper = String(sport || "").toUpperCase();
      const propLower = String(prop || "").toLowerCase();

      // Sport-specific baselines based on league averages
      const baselines = {
        NBA: {
          points: 15.5,
          rebounds: 6.2,
          assists: 3.8,
          steals: 1.1,
          blocks: 0.8,
          threes: 1.5,
          "three-pointers": 1.5,
          "3pt": 1.5,
          turnovers: 1.8,
          minutes: 26.5,
        },
        WNBA: {
          points: 11.2,
          rebounds: 5.1,
          assists: 2.9,
          steals: 1.0,
          blocks: 0.6,
          threes: 1.2,
          "three-pointers": 1.2,
          "3pt": 1.2,
          turnovers: 1.5,
          minutes: 24.0,
        },
        MLB: {
          strikeouts: 5.8,
          hits: 1.2,
          runs: 0.8,
          rbis: 0.9,
          "home runs": 0.3,
          "stolen bases": 0.2,
          walks: 0.7,
          "earned runs": 3.5,
          innings: 5.5,
        },
        NFL: {
          "passing yards": 235,
          "rushing yards": 68,
          "receiving yards": 48,
          touchdowns: 1.2,
          receptions: 4.5,
          completions: 22,
          attempts: 34,
          interceptions: 0.8,
          "field goals": 1.8,
        }
      };

      const sportBaselines = baselines[sportUpper];
      if (!sportBaselines) {
        console.warn(`[StatisticalModels] No baselines defined for sport: ${sportUpper}`);
        return null;
      }

      // Match prop type to baseline category
      // Check for exact matches first
      for (const [key, value] of Object.entries(sportBaselines)) {
        if (propLower.includes(key)) {
          return value;
        }
      }

      // Fallback to abbreviations and common variations
      if (propLower.includes("pts") || propLower.includes("point")) return sportBaselines.points;
      if (propLower.includes("reb") || propLower.includes("rebound")) return sportBaselines.rebounds;
      if (propLower.includes("ast") || propLower.includes("assist")) return sportBaselines.assists;
      if (propLower.includes("stl") || propLower.includes("steal")) return sportBaselines.steals;
      if (propLower.includes("blk") || propLower.includes("block")) return sportBaselines.blocks;
      if (propLower.includes("to") || propLower.includes("turnover")) return sportBaselines.turnovers;
      if (propLower.includes("min") || propLower.includes("minute")) return sportBaselines.minutes;
      if (propLower.includes("k") || propLower.includes("strikeout")) return sportBaselines.strikeouts;
      if (propLower.includes("hit") && !propLower.includes("didn")) return sportBaselines.hits;
      if (propLower.includes("run") && !propLower.includes("earned")) return sportBaselines.runs;
      if (propLower.includes("rbi")) return sportBaselines.rbis;
      if (propLower.includes("hr") || propLower.includes("homer")) return sportBaselines["home runs"];
      if (propLower.includes("sb") || propLower.includes("stolen")) return sportBaselines["stolen bases"];
      if (propLower.includes("bb") || propLower.includes("walk")) return sportBaselines.walks;
      if (propLower.includes("er") || propLower.includes("earned")) return sportBaselines["earned runs"];
      if (propLower.includes("ip") || propLower.includes("inning")) return sportBaselines.innings;
      if (propLower.includes("pass") && propLower.includes("yard")) return sportBaselines["passing yards"];
      if (propLower.includes("rush") && propLower.includes("yard")) return sportBaselines["rushing yards"];
      if (propLower.includes("rec") && propLower.includes("yard")) return sportBaselines["receiving yards"];
      if (propLower.includes("td") || propLower.includes("touchdown")) return sportBaselines.touchdowns;
      if (propLower.includes("rec") && !propLower.includes("yard")) return sportBaselines.receptions;
      if (propLower.includes("comp") || propLower.includes("completion")) return sportBaselines.completions;
      if (propLower.includes("att") || propLower.includes("attempt")) return sportBaselines.attempts;
      if (propLower.includes("int") || propLower.includes("interception")) return sportBaselines.interceptions;
      if (propLower.includes("fg") || propLower.includes("field goal")) return sportBaselines["field goals"];

      console.warn(`[StatisticalModels] No baseline match found for prop: ${prop} in sport: ${sportUpper}`);
      return null;
    } catch (err) {
      console.error("[StatisticalModels] getBaseline error:", err?.message || err);
      return null;
    }
  }
};
