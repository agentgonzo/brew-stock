# Brew Stock Manager

A lightweight, self-hosted web app for managing homebrewing ingredient stock. Import beer recipes from Grainfather (via BeerXML export), track stock levels of malts, hops, and yeast, and quickly check whether you have enough ingredients to brew a given recipe.

## Features

- **BeerXML Recipe Import** — Upload Grainfather recipe files; extract ingredients and style.
- **Stock Management** — Track malts (kg), hops (grams), and yeast (packets) with type-specific attributes (EBC, alpha-acid %, attenuation %).
- **Fuzzy Ingredient Matching** — Auto-map recipe ingredients to your stock items using smart fuzzy matching; manually resolve ambiguous ones.
- **Stock Checks** — Per-recipe availability check showing what's in stock, what's short, and what's unmapped.
- **Partial Brews** — Brew even when stock is short; deduct what you have without going negative.
- **Responsive UI** — Works on desktop and mobile (primary target: Pixel 6a, 412px).
- **No Authentication** — Local network only; no login required.

## Quick Start

### Docker (Recommended)

```bash
docker-compose up
```

The app will be available at `http://localhost:3000`. SQLite data persists in the `brew-data` volume.

### Local Development

```bash
npm install
DB_PATH=./data/brew.db PORT=3000 node src/server.js
```

Then open `http://localhost:3000` in your browser.

## Usage

1. **Stock Page** — Add your ingredient stock items (malts, hops, yeast) with quantities and attributes.
2. **Recipes Page** — Upload BeerXML recipe files.
3. **Mappings Page** — Resolve unmatched recipe ingredients by selecting from fuzzy-matched suggestions or manually choosing the correct stock item.
4. **Recipe Detail** — View the recipe, check if you have enough stock, and brew (deducts available stock).

## Architecture

| Layer | Choice |
|-------|--------|
| Backend | Node.js + Fastify |
| Database | SQLite (single file, no setup) |
| Frontend | Plain HTML + CSS + vanilla JS (no framework, no build step) |
| Parsing | fast-xml-parser (BeerXML) + fuse.js (fuzzy matching) |
| Container | Docker (single image, named volume for data) |

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify (lightweight, fast)
- **Database**: SQLite via better-sqlite3 (zero config)
- **Frontend**: Plain HTML/CSS/JS + Pico CSS (CDN)
- **Utilities**: fast-xml-parser, fuse.js, @fastify/multipart, @fastify/static

## Development

### Project Structure

```
src/
  server.js              — Fastify setup, route registration
  db.js                  — SQLite init, schema, migrations
  routes/
    recipes.js           — Recipe import, update, delete, check, brew
    stock.js             — Stock CRUD (create, add, adjust, edit, delete)
    mappings.js          — Mapping list, confirm, delete, unresolved
  services/
    beerxml.js           — BeerXML parser
    fuzzy.js             — Fuzzy matcher (fuse.js wrapper)
    mapping.js           — Auto-apply near-certain mappings

public/
  index.html             — Stock overview (collapsible sections per type)
  recipes.html           — Recipe list and import form
  recipe.html            — Recipe detail, stock check, brew button
  mappings.html          — Resolve unmatched ingredients, manage mappings
  app.js                 — Shared fetch helpers, confirm modal, utilities
  style.css              — Pico overrides (responsive tables, icons, etc.)
```

### Database Schema

- **recipes** — Imported recipe metadata (name, style, raw XML).
- **recipe_ingredients** — Ingredients extracted from recipes (name, type, amount in grams).
- **stock_items** — User-created stock with quantities and type-specific attributes.
- **ingredient_mappings** — Maps recipe ingredient names to stock items (global, reused).

Stock quantities are rounded to the nearest gram on every write to avoid float noise.

### API Endpoints

#### Recipes
- `POST /api/recipes/import` — Upload a BeerXML file
- `GET /api/recipes` — List all recipes
- `GET /api/recipes/:id` — Single recipe with ingredients
- `GET /api/recipes/:id/check` — Stock availability check
- `POST /api/recipes/:id/update` — Replace recipe from new BeerXML
- `POST /api/recipes/:id/brew` — Deduct available stock
- `DELETE /api/recipes/:id` — Delete recipe

#### Stock
- `GET /api/stock` — All stock items
- `POST /api/stock` — Create a stock item
- `POST /api/stock/:id/add` — Add quantity
- `POST /api/stock/:id/adjust` — Set absolute quantity
- `PATCH /api/stock/:id` — Edit name and/or attribute
- `DELETE /api/stock/:id` — Delete stock item

#### Mappings
- `GET /api/mappings` — All confirmed mappings
- `GET /api/mappings/unresolved` — Unresolved ingredients with suggestions
- `POST /api/mappings` — Confirm a mapping
- `DELETE /api/mappings/:name` — Delete a confirmed mapping

## Configuration

### Environment Variables

- `DB_PATH` (default: `/app/data/brew.db`) — SQLite database file path.
- `PORT` (default: `3000`) — HTTP server port.

## License

MIT

## Contributing

This is a personal project. Feel free to fork and adapt it for your own use.
