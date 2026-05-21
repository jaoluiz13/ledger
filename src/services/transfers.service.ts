import { sql } from '../db.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import * as transfersRepo from '../repositories/transfers.repository.js';
import * as entriesRepo from '../repositories/ledger-entries.repository.js';
import type { CreateTransferParams, Transfer } from '../types/ledger.types.js';
import { LedgerError } from '../errors.js';

export async function createTransfer(params: CreateTransferParams): Promise<Transfer> {
  const { fromAccountId, toAccountId, amount, description = null, idempotencyKey } = params;

  if (amount <= 0) throw new LedgerError('Amount must be greater than zero', 'INVALID_AMOUNT');
  if (fromAccountId === toAccountId) {
    throw new LedgerError('Source and destination accounts must differ', 'SAME_ACCOUNT');
  }

  return sql.begin(async (tx) => {
    const existingId = await transfersRepo.findIdByIdempotencyKey(idempotencyKey, tx);
    if (existingId) {
      return transfersRepo.findWithEntries(existingId, tx) as Promise<Transfer>;
    }

    // Lock in deterministic order to prevent deadlocks
    const ordered: [string, string] =
      fromAccountId < toAccountId
        ? [fromAccountId, toAccountId]
        : [toAccountId, fromAccountId];

    const locked = await accountsRepo.lockManyForUpdate(ordered, tx);
    const fromRow = locked.find((a) => a.accountId === fromAccountId);
    const toRow = locked.find((a) => a.accountId === toAccountId);

    if (!fromRow) throw new LedgerError('Source account not found', 'ACCOUNT_NOT_FOUND', 404);
    if (!toRow) throw new LedgerError('Destination account not found', 'ACCOUNT_NOT_FOUND', 404);
    if (fromRow.balance < amount) throw new LedgerError('Insufficient balance', 'INSUFFICIENT_BALANCE');

    const { transferId, createdAt } = await transfersRepo.insert(
      { fromAccountId, toAccountId, amount, description, idempotencyKey },
      tx,
    );

    const entries = await entriesRepo.insertDebitAndCredit(
      fromAccountId, toAccountId, transferId, amount, tx,
    );

    await accountsRepo.incrementBalance(fromAccountId, -amount, tx);
    await accountsRepo.incrementBalance(toAccountId, amount, tx);

    return { id: transferId, fromAccountId, toAccountId, amount, description, idempotencyKey, status: 'completed', createdAt, entries };
  });
}
