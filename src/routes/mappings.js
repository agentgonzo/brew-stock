'use strict';

const db = require('../db');
const { suggestMatches } = require('../services/fuzzy');
const { autoApplyMappings } = require('../services/mapping');

module.exports = async function mappingRoutes(fastify) {
  // Distinct recipe ingredient names that have no confirmed mapping yet,
  // each with up to 3 fuzzy suggestions from stock of the same type.
  fastify.get('/api/mappings/unresolved', async () => {
    // Resolve any near-certain matches first; only ambiguous names remain.
    autoApplyMappings(db);

    const unresolved = db
      .prepare(
        `SELECT ri.name AS name, ri.type AS type
           FROM recipe_ingredients ri
           LEFT JOIN ingredient_mappings m ON m.recipe_ingredient_name = ri.name
          WHERE m.recipe_ingredient_name IS NULL
          GROUP BY ri.name, ri.type
          ORDER BY ri.type, ri.name`
      )
      .all();

    const stockItems = db
      .prepare('SELECT id, name, type, quantity, unit FROM stock_items')
      .all();

    return unresolved.map((ing) => ({
      name: ing.name,
      type: ing.type,
      suggestions: suggestMatches(ing.name, ing.type, stockItems),
    }));
  });

  // All confirmed mappings, with the stock item each points to.
  fastify.get('/api/mappings', async () => {
    return db
      .prepare(
        `SELECT m.recipe_ingredient_name AS name,
                m.stock_item_id          AS stock_item_id,
                s.name                   AS stock_name,
                s.type                   AS type
           FROM ingredient_mappings m
           JOIN stock_items s ON s.id = m.stock_item_id
          ORDER BY s.type, m.recipe_ingredient_name`
      )
      .all();
  });

  // Delete a confirmed mapping by its recipe ingredient name. The name then
  // falls back to unresolved (or is re-applied automatically if it's a
  // near-certain fuzzy match — see autoApplyMappings).
  fastify.delete('/api/mappings/:name', async (request, reply) => {
    const result = db
      .prepare('DELETE FROM ingredient_mappings WHERE recipe_ingredient_name = ?')
      .run(request.params.name);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'mapping not found' });
    }
    return { deleted: true };
  });

  // Confirm a mapping. Reused automatically for all future recipes.
  fastify.post('/api/mappings', async (request, reply) => {
    const { recipe_ingredient_name, stock_item_id } = request.body || {};

    if (!recipe_ingredient_name || stock_item_id == null) {
      return reply
        .code(400)
        .send({ error: 'recipe_ingredient_name and stock_item_id are required' });
    }

    const stockItem = db
      .prepare('SELECT id FROM stock_items WHERE id = ?')
      .get(stock_item_id);
    if (!stockItem) {
      return reply.code(404).send({ error: 'stock item not found' });
    }

    db.prepare(
      `INSERT INTO ingredient_mappings (recipe_ingredient_name, stock_item_id)
       VALUES (?, ?)
       ON CONFLICT(recipe_ingredient_name) DO UPDATE SET stock_item_id = excluded.stock_item_id`
    ).run(recipe_ingredient_name, stock_item_id);

    return reply.code(201).send({ recipe_ingredient_name, stock_item_id });
  });
};
