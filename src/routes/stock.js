'use strict';

const db = require('../db');

const VALID_TYPES = new Set(['malt', 'hop', 'yeast']);

// Default storage unit per type: malt in kg, hops in grams, yeast in packets.
const DEFAULT_UNIT = { malt: 'kg', hop: 'g', yeast: 'packet' };

const SELECT_COLS =
  'id, name, type, quantity, unit, ebc, alpha_acid, attenuation';

function getItem(id) {
  return db
    .prepare(`SELECT ${SELECT_COLS} FROM stock_items WHERE id = ?`)
    .get(id);
}

// Coerce a value to a finite number or null (for nullable attributes).
// Empty string / null / undefined all mean "clear" -> null (note Number('')
// is 0, which we must not treat as a real value here).
function numOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Round a quantity to the nearest gram for its unit: kg keeps 3 decimals
// (1 g = 0.001 kg), grams/packets are whole numbers.
function roundQty(value, unit) {
  const factor = unit === 'kg' ? 1000 : 1;
  return Math.round(value * factor) / factor;
}

// SQL fragment that rounds a quantity expression to the nearest gram based on
// the row's unit (kg -> 3 dp, g/packet -> whole). Used by add / adjust.
const ROUND_SQL = (expr) =>
  `ROUND(${expr}, CASE unit WHEN 'kg' THEN 3 ELSE 0 END)`;

module.exports = async function stockRoutes(fastify) {
  // List all stock items.
  fastify.get('/api/stock', async () => {
    return db
      .prepare(`SELECT ${SELECT_COLS} FROM stock_items ORDER BY type, name`)
      .all();
  });

  // Create a new stock item.
  fastify.post('/api/stock', async (request, reply) => {
    const { name, type, quantity, unit, ebc, alpha_acid, attenuation } =
      request.body || {};

    if (!name || !VALID_TYPES.has(type)) {
      return reply.code(400).send({ error: 'name and a valid type (malt|hop|yeast) are required' });
    }

    const resolvedUnit = unit || DEFAULT_UNIT[type];
    const qty = roundQty(Number.isFinite(quantity) ? quantity : 0, resolvedUnit);

    // Only the attribute relevant to the type is stored; others stay null.
    const info = db
      .prepare(
        `INSERT INTO stock_items (name, type, quantity, unit, ebc, alpha_acid, attenuation)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        type,
        qty,
        resolvedUnit,
        type === 'malt' ? numOrNull(ebc) : null,
        type === 'hop' ? numOrNull(alpha_acid) : null,
        type === 'yeast' ? numOrNull(attenuation) : null
      );

    return reply.code(201).send(getItem(info.lastInsertRowid));
  });

  // Add quantity (e.g. a delivery arrived).
  fastify.post('/api/stock/:id/add', async (request, reply) => {
    const { amount } = request.body || {};
    const delta = Number(amount);

    if (!Number.isFinite(delta)) {
      return reply.code(400).send({ error: 'amount must be a number' });
    }

    const result = db
      .prepare(`UPDATE stock_items SET quantity = ${ROUND_SQL('quantity + ?')} WHERE id = ?`)
      .run(delta, request.params.id);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'stock item not found' });
    }

    return getItem(request.params.id);
  });

  // Set an absolute quantity (manual correction, also used to zero out).
  fastify.post('/api/stock/:id/adjust', async (request, reply) => {
    const { quantity } = request.body || {};
    const qty = Number(quantity);

    if (!Number.isFinite(qty)) {
      return reply.code(400).send({ error: 'quantity must be a number' });
    }

    const result = db
      .prepare(`UPDATE stock_items SET quantity = ${ROUND_SQL('?')} WHERE id = ?`)
      .run(qty, request.params.id);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'stock item not found' });
    }

    return getItem(request.params.id);
  });

  // Edit a stock item's name and/or its type-specific attribute.
  // Only the fields present in the body are changed; an attribute sent as
  // empty/non-numeric clears it (set to null).
  fastify.patch('/api/stock/:id', async (request, reply) => {
    const item = getItem(request.params.id);
    if (!item) {
      return reply.code(404).send({ error: 'stock item not found' });
    }

    const body = request.body || {};
    const fields = [];
    const values = [];

    if ('name' in body) {
      const name = String(body.name).trim();
      if (!name) {
        return reply.code(400).send({ error: 'name cannot be empty' });
      }
      fields.push('name = ?');
      values.push(name);
    }

    for (const col of ['ebc', 'alpha_acid', 'attenuation']) {
      if (col in body) {
        fields.push(`${col} = ?`);
        values.push(numOrNull(body[col]));
      }
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'no editable fields provided' });
    }

    values.push(request.params.id);
    db.prepare(`UPDATE stock_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return getItem(request.params.id);
  });

  // Delete a stock item entirely. Any confirmed mappings to it cascade away.
  fastify.delete('/api/stock/:id', async (request, reply) => {
    const result = db
      .prepare('DELETE FROM stock_items WHERE id = ?')
      .run(request.params.id);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'stock item not found' });
    }

    return { deleted: true };
  });
};
