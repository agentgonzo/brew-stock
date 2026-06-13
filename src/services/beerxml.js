'use strict';

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: true,
  // BeerXML tags are conventionally uppercase; keep names as-is.
  parseTagValue: false,
  trimValues: true,
});

// fast-xml-parser collapses a single child into an object rather than an array.
// This always gives us an array to iterate over.
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

// kilograms -> grams, rounded to avoid float noise like 4499.9999.
function kgToGrams(amount) {
  const kg = parseFloat(amount);
  if (Number.isNaN(kg)) return 0;
  return Math.round(kg * 1000);
}

/**
 * Parse a BeerXML document into a recipe and a flat ingredient list.
 * @param {string} xml raw BeerXML
 * @returns {{ recipe: {name, style}, ingredients: Array<{name,type,amount,unit}> }}
 */
function parseBeerXML(xml) {
  const doc = parser.parse(xml);

  // <RECIPES><RECIPE>... — take the first recipe.
  const recipesNode = doc.RECIPES || doc.recipes || {};
  const recipe = asArray(recipesNode.RECIPE || recipesNode.recipe)[0];

  if (!recipe) {
    throw new Error('No <RECIPE> element found in BeerXML');
  }

  const name = text(recipe.NAME) || 'Untitled recipe';
  const styleNode = recipe.STYLE || {};
  const style = text(styleNode.NAME) || null;

  const ingredients = [];

  // Fermentables (malt) — kg -> g
  for (const f of asArray((recipe.FERMENTABLES || {}).FERMENTABLE)) {
    const fName = text(f.NAME);
    if (!fName) continue;
    ingredients.push({
      name: fName,
      type: 'malt',
      amount: kgToGrams(f.AMOUNT),
      unit: 'g',
    });
  }

  // Hops — kg -> g. Multiple additions of the same hop (e.g. bittering + dry
  // hop) are summed into a single ingredient row.
  const hopTotals = new Map();
  for (const h of asArray((recipe.HOPS || {}).HOP)) {
    const hName = text(h.NAME);
    if (!hName) continue;
    hopTotals.set(hName, (hopTotals.get(hName) || 0) + kgToGrams(h.AMOUNT));
  }
  for (const [hName, total] of hopTotals) {
    ingredients.push({ name: hName, type: 'hop', amount: total, unit: 'g' });
  }

  // Yeast — stored as a single packet.
  for (const y of asArray((recipe.YEASTS || {}).YEAST)) {
    const yName = text(y.NAME);
    if (!yName) continue;
    ingredients.push({
      name: yName,
      type: 'yeast',
      amount: 1,
      unit: 'packet',
    });
  }

  return { recipe: { name, style }, ingredients };
}

module.exports = { parseBeerXML };
