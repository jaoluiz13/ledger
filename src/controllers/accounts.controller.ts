import type { FastifyRequest, FastifyReply } from 'fastify';
import * as accountsService from '../services/accounts.service.js';
import * as entriesRepo from '../repositories/ledger-entries.repository.js';

export async function createAccount(req: FastifyRequest, reply: FastifyReply) {
  const { name, initialBalance } = req.body as { name: string; initialBalance?: number };

  const account = await accountsService.createAccount({ name, initialBalance });
  return reply.status(201).send({
    id: account.id,
    name: account.name,
    balance: account.balance,
    created_at: account.createdAt,
  });
}

export async function getAccount(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const account = await accountsService.getAccount(id);
  return reply.send({
    id: account.id,
    name: account.name,
    balance: account.balance,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  });
}

export async function getLedger(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const { limit = 50 } = req.query as { limit?: number };

  const entries = await entriesRepo.findByAccountId(id, limit);
  return reply.send(
    entries.map((e) => ({
      id: e.id,
      account_id: e.accountId,
      transfer_id: e.transferId,
      amount: e.amount,
      created_at: e.createdAt,
    })),
  );
}

export async function reconcileAccount(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const result = await accountsService.reconcileAccount(id);
  return reply.send(result);
}

export async function reconcileAll(_req: FastifyRequest, reply: FastifyReply) {
  const results = await accountsService.reconcileAll();
  return reply.send(results);
}
