'use strict';

const path = require('path');
const Fastify = require('fastify');

const fastify = Fastify({ logger: true });

async function start() {
  // File uploads (BeerXML import). 5 MB is plenty for a recipe file.
  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // Serve the frontend from public/ at the site root.
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // API routes.
  await fastify.register(require('./routes/recipes'));
  await fastify.register(require('./routes/stock'));
  await fastify.register(require('./routes/mappings'));

  const port = Number(process.env.PORT) || 3000;
  await fastify.listen({ port, host: '0.0.0.0' });
}

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
