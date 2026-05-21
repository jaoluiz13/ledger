import Fastify from 'fastify';
import cors from '@fastify/cors';
import { accountsRoutes } from './routes/accounts.routes.js';
import { transfersRoutes } from './routes/transfers.routes.js';
import { reconcileAll as reconcileAllAccounts } from './controllers/accounts.controller.js';
import { LedgerError } from './errors.js';
import { closeDb } from './db.js';
import { reconcileAllSchema } from './schemas/accounts.schemas.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

await app.register(cors);

app.setErrorHandler((error: any, _req, reply) => {
  // Fastify schema validation errors
  if (error.validation) {
    const messages = error.validation.map((v: any) => `${v.instancePath} ${v.message}`.trim()).join(', ');
    return reply.status(400).send({ error: messages || error.message, code: 'VALIDATION_ERROR' });
  }
  if (error instanceof LedgerError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  app.log.error(error);
  return reply.status(500).send({ error: 'Internal server error' });
});

app.get('/health', async (_req, reply) => {
  return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/reconcile', { schema: reconcileAllSchema }, reconcileAllAccounts);

await app.register(accountsRoutes);
await app.register(transfersRoutes);

const signals = ['SIGINT', 'SIGTERM'] as const;
for (const signal of signals) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: '0.0.0.0' });

export { app };
