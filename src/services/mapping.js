'use strict';

const { scoredMatches, AUTO_APPLY_SCORE } = require('./fuzzy');

/**
 * Confirm a mapping automatically for any unmapped recipe ingredient whose
 * best same-type stock match is near-certain (score <= AUTO_APPLY_SCORE).
 *
 * This keeps the manual Mappings list short: identical/near-identical names
 * resolve silently, and only genuinely ambiguous names are left to prompt.
 * Idempotent — only acts on currently-unmapped names, never overwrites a
 * mapping the user already confirmed.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number} how many mappings were auto-applied
 */
function autoApplyMappings(db) {
  const unmapped = db
    .prepare(
      `SELECT ri.name AS name, ri.type AS type
         FROM recipe_ingredients ri
         LEFT JOIN ingredient_mappings m ON m.recipe_ingredient_name = ri.name
        WHERE m.recipe_ingredient_name IS NULL
        GROUP BY ri.name, ri.type`
    )
    .all();

  if (unmapped.length === 0) return 0;

  const stock = db.prepare('SELECT id, name, type, quantity, unit FROM stock_items').all();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ingredient_mappings (recipe_ingredient_name, stock_item_id)
     VALUES (?, ?)`
  );

  let applied = 0;
  for (const ing of unmapped) {
    const best = scoredMatches(ing.name, ing.type, stock, 1)[0];
    if (best && best.score <= AUTO_APPLY_SCORE) {
      insert.run(ing.name, best.id);
      applied += 1;
    }
  }
  return applied;
}

module.exports = { autoApplyMappings };
