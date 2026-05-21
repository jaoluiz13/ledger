import { sql, type Tx } from '../db.js';
import type { LedgerEntry } from '../types/ledger.types.js';

export async function insertDebitAndCredit(
  fromAccountId: string,
  toAccountId: string,
  transferId: string,
  amount: number,
  tx: Tx,
): Promise<LedgerEntry[]> {
  return tx<LedgerEntry[]>`
    INSERT INTO ledger_entries (account_id, transfer_id, amount)
    VALUES
      (${fromAccountId}, ${transferId}, ${-amount}),
      (${toAccountId},   ${transferId}, ${amount})
    RETURNING ledger_entry_id AS id, account_id, transfer_id, amount, created_at
  `;
}

export async function findByAccountId(
  accountId: string,
  limit: number,
  tx: Tx = sql,
): Promise<LedgerEntry[]> {
  return tx<LedgerEntry[]>`
    SELECT le.ledger_entry_id AS id, le.account_id, le.transfer_id, le.amount, le.created_at
    FROM ledger_entries le
    WHERE le.account_id = ${accountId}
    ORDER BY le.created_at DESC
    LIMIT ${limit}
  `;
}
