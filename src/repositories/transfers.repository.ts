import type { Tx } from '../db.js';
import type { Transfer } from '../types/ledger.types.js';

export interface TransferInsertData {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string | null;
  idempotencyKey: string;
}

export async function findIdByIdempotencyKey(key: string, tx: Tx): Promise<string | null> {
  const [row] = await tx<Array<{ transferId: string }>>`
    SELECT transfer_id FROM transfers WHERE idempotency_key = ${key}
  `;
  return row?.transferId ?? null;
}

export async function insert(
  data: TransferInsertData,
  tx: Tx,
): Promise<{ transferId: string; createdAt: Date }> {
  const [row] = await tx<Array<{ transferId: string; createdAt: Date }>>`
    INSERT INTO transfers (from_account_id, to_account_id, amount, description, idempotency_key)
    VALUES (${data.fromAccountId}, ${data.toAccountId}, ${data.amount}, ${data.description}, ${data.idempotencyKey})
    RETURNING transfer_id, created_at
  `;
  return row;
}

export async function findWithEntries(transferId: string, tx: Tx): Promise<Transfer | null> {
  const [t] = await tx<Array<{
    transferId: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    description: string | null;
    idempotencyKey: string;
    status: string;
    createdAt: Date;
  }>>`
    SELECT transfer_id, from_account_id, to_account_id, amount,
           description, idempotency_key, status, created_at
    FROM transfers
    WHERE transfer_id = ${transferId}
  `;

  if (!t) return null;

  const entries = await tx<Array<{
    id: string;
    accountId: string;
    transferId: string;
    amount: number;
    createdAt: Date;
  }>>`
    SELECT ledger_entry_id AS id, account_id, transfer_id, amount, created_at
    FROM ledger_entries
    WHERE transfer_id = ${transferId}
  `;

  return {
    id: t.transferId,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amount: t.amount,
    description: t.description,
    idempotencyKey: t.idempotencyKey,
    status: t.status,
    createdAt: t.createdAt,
    entries,
  };
}
