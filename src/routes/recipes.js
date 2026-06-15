'use strict';

const db = require('../db');
const { parseBeerXML } = require('../services/beerxml');
const { autoApplyMappings } = require('../services/mapping');

// Grams per unit, for weight conversions. Recipe amounts are stored in grams;
// malt stock is now kept in kg, so a required amount must be converted into
// the stock item's own unit before comparing or deducting.
const GRAMS_PER = { g: 1, kg: 1000 };

function convert(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  const from = GRAMS_PER[fromUnit];
  const to = GRAMS_PER[toUnit];
  if (from && to) {
    // Round to 3 dp to avoid float noise like 4.4999999.
    return Math.round((amount * from) / to * 1000) / 1000;
  }
  return amount; // packet/packet or unknown — no conversion.
}

// Build the stock-check rows for a recipe. Shared by /check and /brew.
// Each row resolves a recipe ingredient -> mapped stock item -> availability.
function buildCheck(recipeId) {
  // Pick up any near-certain mappings before checking availability.
  autoApplyMappings(db);

  const ingredients = db
    .prepare('SELECT name, type, amount, unit FROM recipe_ingredients WHERE recipe_id = ?')
    .all(recipeId);

  const findMapping = db.prepare(
    `SELECT s.id AS stock_item_id, s.quantity AS quantity, s.unit AS unit
       FROM ingredient_mappings m
       JOIN stock_items s ON s.id = m.stock_item_id
      WHERE m.recipe_ingredient_name = ?`
  );

  const rows = ingredients.map((ing) => {
    const mapped = findMapping.get(ing.name);

    if (!mapped) {
      return {
        name: ing.name,
        type: ing.type,
        required: ing.amount,
        inStock: null,
        unit: ing.unit,
        unresolved: true,
        stockItemId: null,
        ok: false,
      };
    }

    // Express the required amount in the stock item's unit (e.g. malt in kg).
    const required = convert(ing.amount, ing.unit, mapped.unit);

    return {
      name: ing.name,
      type: ing.type,
      required,
      inStock: mapped.quantity,
      unit: mapped.unit,
      ok: mapped.quantity >= required,
      stockItemId: mapped.stock_item_id,
    };
  });

  const brewable = rows.length > 0 && rows.every((r) => r.ok && !r.unresolved);
  return { brewable, rows };
}

// Read and parse an uploaded BeerXML file from a multipart request.
// Returns { xml, parsed } on success, or { error } on failure.
async function readBeerXMLUpload(request) {
  const file = await request.file();
  if (!file) return { error: 'no file uploaded' };

  const buffer = await file.toBuffer();
  const xml = buffer.toString('utf8');

  try {
    return { xml, parsed: parseBeerXML(xml) };
  } catch (err) {
    return { error: `invalid BeerXML: ${err.message}` };
  }
}

const insertIngredient = db.prepare(
  'INSERT INTO recipe_ingredients (recipe_id, name, type, amount, unit) VALUES (?, ?, ?, ?, ?)'
);

module.exports = async function recipeRoutes(fastify) {
  // Import a BeerXML file (multipart upload, field name irrelevant).
  fastify.post('/api/recipes/import', async (request, reply) => {
    const { xml, parsed, error } = await readBeerXMLUpload(request);
    if (error) return reply.code(400).send({ error });

    const insertRecipe = db.prepare(
      'INSERT INTO recipes (name, style, raw_xml) VALUES (?, ?, ?)'
    );

    const tx = db.transaction(() => {
      const info = insertRecipe.run(parsed.recipe.name, parsed.recipe.style, xml);
      const recipeId = info.lastInsertRowid;
      for (const ing of parsed.ingredients) {
        insertIngredient.run(recipeId, ing.name, ing.type, ing.amount, ing.unit);
      }
      return recipeId;
    });

    const recipeId = tx();
    const recipe = db
      .prepare('SELECT id, name, style, imported_at FROM recipes WHERE id = ?')
      .get(recipeId);

    return reply.code(201).send(recipe);
  });

  // Replace a recipe's contents from a new BeerXML file, keeping the same id.
  fastify.post('/api/recipes/:id/update', async (request, reply) => {
    const recipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(request.params.id);
    if (!recipe) {
      return reply.code(404).send({ error: 'recipe not found' });
    }

    const { xml, parsed, error } = await readBeerXMLUpload(request);
    if (error) return reply.code(400).send({ error });

    const updateRecipe = db.prepare(
      'UPDATE recipes SET name = ?, style = ?, raw_xml = ? WHERE id = ?'
    );
    const deleteIngredients = db.prepare(
      'DELETE FROM recipe_ingredients WHERE recipe_id = ?'
    );

    const tx = db.transaction(() => {
      updateRecipe.run(parsed.recipe.name, parsed.recipe.style, xml, request.params.id);
      deleteIngredients.run(request.params.id);
      for (const ing of parsed.ingredients) {
        insertIngredient.run(request.params.id, ing.name, ing.type, ing.amount, ing.unit);
      }
    });
    tx();

    return db
      .prepare('SELECT id, name, style, imported_at FROM recipes WHERE id = ?')
      .get(request.params.id);
  });

  // Delete a recipe and its ingredients. Ingredient mappings are global and
  // shared across recipes, so they are intentionally left intact.
  fastify.delete('/api/recipes/:id', async (request, reply) => {
    const result = db
      .prepare('DELETE FROM recipes WHERE id = ?')
      .run(request.params.id);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'recipe not found' });
    }

    return { deleted: true };
  });

  // List all recipes (no raw XML in the list).
  fastify.get('/api/recipes', async () => {
    return db
      .prepare('SELECT id, name, style, imported_at FROM recipes ORDER BY imported_at DESC, id DESC')
      .all();
  });

  // Single recipe with its ingredients.
  fastify.get('/api/recipes/:id', async (request, reply) => {
    const recipe = db
      .prepare('SELECT id, name, style, imported_at FROM recipes WHERE id = ?')
      .get(request.params.id);

    if (!recipe) {
      return reply.code(404).send({ error: 'recipe not found' });
    }

    recipe.ingredients = db
      .prepare('SELECT name, type, amount, unit FROM recipe_ingredients WHERE recipe_id = ? ORDER BY type, name')
      .all(request.params.id);

    return recipe;
  });

  // Stock check: enough / short / unresolved per ingredient.
  fastify.get('/api/recipes/:id/check', async (request, reply) => {
    const recipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(request.params.id);
    if (!recipe) {
      return reply.code(404).send({ error: 'recipe not found' });
    }

    const { brewable, rows } = buildCheck(request.params.id);
    // Strip internal fields from the public response shape.
    const ingredients = rows.map(({ stockItemId, ...rest }) => rest);
    return { brewable, ingredients };
  });

  // Deduct stock for a brew. Partial brews are allowed: short ingredients are
  // deducted down to zero (never negative) and unresolved ones are skipped.
  // Always succeeds; reports what fell short / wasn't deducted.
  fastify.post('/api/recipes/:id/brew', async (request, reply) => {
    const recipe = db.prepare('SELECT id FROM recipes WHERE id = ?').get(request.params.id);
    if (!recipe) {
      return reply.code(404).send({ error: 'recipe not found' });
    }

    const { rows } = buildCheck(request.params.id);
    // MAX(0, ...) guarantees stock never goes negative; ROUND keeps it to the
    // nearest gram (kg -> 3 dp, g/packet -> whole) after deduction.
    const deduct = db.prepare(
      `UPDATE stock_items
          SET quantity = MAX(0, ROUND(quantity - ?, CASE unit WHEN 'kg' THEN 3 ELSE 0 END))
        WHERE id = ?`
    );

    const short = [];
    const unresolved = [];
    const tx = db.transaction(() => {
      for (const r of rows) {
        if (r.unresolved) {
          unresolved.push(r.name);
          continue;
        }
        if (r.inStock < r.required) {
          short.push({ name: r.name, required: r.required, had: r.inStock, unit: r.unit });
        }
        deduct.run(r.required, r.stockItemId);
      }
    });
    tx();

    return { brewed: true, short, unresolved };
  });
};
