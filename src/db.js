'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/app/data/brew.db';

// Ensure the parent directory exists (named volume mount or local ./data).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema is created on startup if absent. No audit log table by design.
db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    style       TEXT,
    raw_xml     TEXT NOT NULL,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,   -- 'malt', 'hop', 'yeast'
    amount      REAL NOT NULL,   -- grams (malt/hop) or units (yeast)
    unit        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,   -- 'malt', 'hop', 'yeast'
    quantity    REAL NOT NULL DEFAULT 0,
    unit        TEXT NOT NULL,   -- 'kg' for malt, 'g' for hop, 'packet' for yeast
    -- Type-specific attributes (nullable; only one is meaningful per type):
    ebc         REAL,            -- malt colour
    alpha_acid  REAL,            -- hop alpha-acid %
    attenuation REAL             -- yeast attenuation %
  );

  CREATE TABLE IF NOT EXISTS ingredient_mappings (
    recipe_ingredient_name  TEXT PRIMARY KEY,
    stock_item_id           INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE
  );
`);

// Migration: add type-specific attribute columns to pre-existing databases.
const stockColumns = new Set(
  db.prepare('PRAGMA table_info(stock_items)').all().map((c) => c.name)
);
for (const col of ['ebc', 'alpha_acid', 'attenuation']) {
  if (!stockColumns.has(col)) {
    db.exec(`ALTER TABLE stock_items ADD COLUMN ${col} REAL`);
  }
}

// Clean up any pre-existing float noise: round all stock to the nearest gram
// (kg -> 3 dp, g/packet -> whole). Idempotent.
db.exec(
  `UPDATE stock_items SET quantity = ROUND(quantity, CASE unit WHEN 'kg' THEN 3 ELSE 0 END)`
);

module.exports = db;
