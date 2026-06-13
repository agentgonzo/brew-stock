'use strict';

const Fuse = require('fuse.js');

const FUSE_OPTIONS = {
  keys: ['name'],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
};

// A Fuse score at or below this is treated as a near-certain match and is
// applied automatically without prompting the user. Fuse scores run 0
// (perfect) to 1 (no match); a verbose recipe name whose stock name appears
// as a clean prefix/substring scores well below this.
const AUTO_APPLY_SCORE = 0.2;

/**
 * Score every same-type stock item against a recipe ingredient name.
 *
 * Stock is filtered by ingredient type first to reduce false positives
 * (a hop should never be suggested for a malt).
 *
 * Matching direction matters: Grainfather recipe names are long and verbose
 * ("Maris Otter Pale Malt (Thomas Fawcett)") while stock names are short
 * ("Maris Otter"). We therefore index the (single) recipe name and search it
 * using each stock name as the pattern — a short pattern found inside a long
 * target scores far better under Fuse's bitap than the reverse.
 *
 * @returns {Array<{id,name,unit,score}>} sorted best-first
 */
function scoredMatches(ingredientName, type, stockItems, limit = 3) {
  const candidates = stockItems.filter((s) => s.type === type);
  if (candidates.length === 0) return [];

  const fuse = new Fuse([{ name: ingredientName }], FUSE_OPTIONS);

  return candidates
    .map((s) => {
      const hit = fuse.search(s.name)[0];
      return hit ? { id: s.id, name: s.name, unit: s.unit, score: hit.score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

/**
 * The top stock-item suggestions for a recipe ingredient name, without scores.
 * @returns {Array<{id,name,unit}>}
 */
function suggestMatches(ingredientName, type, stockItems, limit = 3) {
  return scoredMatches(ingredientName, type, stockItems, limit).map(
    ({ score, ...rest }) => rest
  );
}

module.exports = { suggestMatches, scoredMatches, AUTO_APPLY_SCORE };
