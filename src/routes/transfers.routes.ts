import type { FastifyInstance } from 'fastify';
import * as transfersController from '../controllers/transfers.controller.js';
import { createTransferSchema } from '../schemas/transfers.schemas.js';

export async function transfersRoutes(app: FastifyInstance) {
  app.post('/transfers', { schema: createTransferSchema }, transfersController.createTransfer);
}
