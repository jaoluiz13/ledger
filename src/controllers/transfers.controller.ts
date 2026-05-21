import type { FastifyRequest, FastifyReply } from 'fastify';
import * as transfersService from '../services/transfers.service.js';

export async function createTransfer(req: FastifyRequest, reply: FastifyReply) {
  const { fromAccountId, toAccountId, amount, description, idempotencyKey } = req.body as {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    description?: string;
    idempotencyKey: string;
  };

  const transfer = await transfersService.createTransfer({
    fromAccountId,
    toAccountId,
    amount,
    description,
    idempotencyKey,
  });

  return reply.status(201).send({
    id: transfer.id,
    from_account_id: transfer.fromAccountId,
    to_account_id: transfer.toAccountId,
    amount: transfer.amount,
    description: transfer.description,
    idempotency_key: transfer.idempotencyKey,
    status: transfer.status,
    created_at: transfer.createdAt,
    entries: transfer.entries.map((e) => ({
      id: e.id,
      account_id: e.accountId,
      transfer_id: e.transferId,
      amount: e.amount,
      created_at: e.createdAt,
    })),
  });
}
