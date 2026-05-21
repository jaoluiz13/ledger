import type { FastifyInstance } from 'fastify';
import * as accountsController from '../controllers/accounts.controller.js';
import {
  createAccountSchema,
  getAccountSchema,
  getLedgerSchema,
  reconcileAccountSchema,
} from '../schemas/accounts.schemas.js';

export async function accountsRoutes(app: FastifyInstance) {
  app.post('/accounts', { schema: createAccountSchema }, accountsController.createAccount);
  app.get('/accounts/:id', { schema: getAccountSchema }, accountsController.getAccount);
  app.get('/accounts/:id/ledger', { schema: getLedgerSchema }, accountsController.getLedger);
  app.get('/accounts/:id/reconcile', { schema: reconcileAccountSchema }, accountsController.reconcileAccount);
}
