import { sql } from '../db.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import * as transfersRepo from '../repositories/transfers.repository.js';
import type { CreateTransferParams, Transfer } from '../types/ledger.types.js';
import { LedgerError } from '../errors.js';

export async function createTransfer(params: CreateTransferParams): Promise<Transfer> {
  const { fromAccountId, toAccountId, amount, description = null, idempotencyKey } = params;

  if (amount <= 0) throw new LedgerError('Amount must be greater than zero', 'INVALID_AMOUNT');
  if (fromAccountId === toAccountId) {
    throw new LedgerError('Source and destination accounts must differ', 'SAME_ACCOUNT');
  }

  // Check idempotency outside the transaction to avoid holding locks on duplicates
  const existing = await transfersRepo.findByIdempotencyKey(idempotencyKey, sql);
  if (existing) return existing;

  const ordered: [string, string] =
    fromAccountId < toAccountId
      ? [fromAccountId, toAccountId]
      : [toAccountId, fromAccountId];

  try {
    return await sql.begin(async (tx) => {
      // Round-trip 1: lock rows in deterministic order, read balances
      const locked = await accountsRepo.lockManyForUpdate(ordered, tx);
      const fromRow = locked.find((a) => a.accountId === fromAccountId);
      const toRow = locked.find((a) => a.accountId === toAccountId);

      if (!fromRow) throw new LedgerError('Source account not found', 'ACCOUNT_NOT_FOUND', 404);
      if (!toRow) throw new LedgerError('Destination account not found', 'ACCOUNT_NOT_FOUND', 404);
      if (fromRow.balance < amount) throw new LedgerError('Insufficient balance', 'INSUFFICIENT_BALANCE');

      // Round-trip 2: INSERT transfer + INSERT entries + UPDATE balances in one CTE
      return transfersRepo.insertWithEntriesAndUpdateBalance(
        { fromAccountId, toAccountId, amount, description, idempotencyKey },
        tx,
      );
    });
  } catch (err: any) {
    // Race condition: two concurrent requests with the same idempotency key both passed
    // the pre-check. The unique constraint on idempotency_key catches the second one.
    if (err.code === '23505') {
      const retry = await transfersRepo.findByIdempotencyKey(idempotencyKey, sql);
      if (retry) return retry;
    }
    throw err;
  }
}
