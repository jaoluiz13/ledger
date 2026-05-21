import type { Tx } from '../db.js';
import type { Transfer } from '../types/ledger.types.js';

export interface TransferInsertData {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string | null;
  idempotencyKey: string;
}

type TransferRow = {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string | null;
  idempotencyKey: string;
  status: string;
  createdAt: Date;
  entryId: string;
  entryAccountId: string;
  entryAmount: number;
  entryCreatedAt: Date;
};

function rowsToTransfer(rows: TransferRow[]): Transfer {
  const t = rows[0];
  return {
    id: t.transferId,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    amount: t.amount,
    description: t.description,
    idempotencyKey: t.idempotencyKey,
    status: t.status,
    createdAt: t.createdAt,
    entries: rows.map((r) => ({
      id: r.entryId,
      accountId: r.entryAccountId,
      transferId: t.transferId,
      amount: r.entryAmount,
      createdAt: r.entryCreatedAt,
    })),
  };
}

export async function findByIdempotencyKey(key: string, tx: Tx): Promise<Transfer | null> {
  const rows = await tx<TransferRow[]>`
    SELECT
      t.transfer_id, t.from_account_id, t.to_account_id, t.amount,
      t.description, t.idempotency_key, t.status, t.created_at,
      le.ledger_entry_id AS entry_id, le.account_id AS entry_account_id,
      le.amount AS entry_amount, le.created_at AS entry_created_at
    FROM transfers t
    JOIN ledger_entries le ON le.transfer_id = t.transfer_id
    WHERE t.idempotency_key = ${key}
  `;
  if (!rows.length) return null;
  return rowsToTransfer(rows);
}

// Single CTE: insert transfer + entries + update balances in one round-trip.
// Locks must already be held by the caller via lockManyForUpdate.
export async function insertWithEntriesAndUpdateBalance(
  data: TransferInsertData,
  tx: Tx,
): Promise<Transfer> {
  const { fromAccountId, toAccountId, amount, description, idempotencyKey } = data;
  const rows = await tx<TransferRow[]>`
    WITH
      new_transfer AS (
        INSERT INTO transfers (from_account_id, to_account_id, amount, description, idempotency_key)
        VALUES (${fromAccountId}, ${toAccountId}, ${amount}, ${description}, ${idempotencyKey})
        RETURNING transfer_id, from_account_id, to_account_id, amount,
                  description, idempotency_key, status, created_at
      ),
      new_entries AS (
        INSERT INTO ledger_entries (account_id, transfer_id, amount)
        SELECT v.aid, t.transfer_id, v.amt
        FROM new_transfer t
        CROSS JOIN (VALUES (${fromAccountId}::uuid, ${-amount}::bigint),
                           (${toAccountId}::uuid,   ${amount}::bigint)) AS v(aid, amt)
        RETURNING ledger_entry_id AS id, account_id, amount, created_at
      ),
      _bal AS (
        UPDATE accounts
        SET balance = balance + CASE
          WHEN account_id = ${fromAccountId} THEN ${-amount}::bigint
          WHEN account_id = ${toAccountId}   THEN ${amount}::bigint
        END
        WHERE account_id = ANY(ARRAY[${fromAccountId}, ${toAccountId}]::uuid[])
      )
    SELECT
      t.transfer_id, t.from_account_id, t.to_account_id, t.amount,
      t.description, t.idempotency_key, t.status, t.created_at,
      e.id AS entry_id, e.account_id AS entry_account_id,
      t.transfer_id AS entry_transfer_id,
      e.amount AS entry_amount, e.created_at AS entry_created_at
    FROM new_transfer t
    JOIN new_entries e ON true
  `;
  return rowsToTransfer(rows);
}

export async function findWithEntries(transferId: string, tx: Tx): Promise<Transfer | null> {
  const rows = await tx<TransferRow[]>`
    SELECT
      t.transfer_id, t.from_account_id, t.to_account_id, t.amount,
      t.description, t.idempotency_key, t.status, t.created_at,
      le.ledger_entry_id AS entry_id, le.account_id AS entry_account_id,
      le.amount AS entry_amount, le.created_at AS entry_created_at
    FROM transfers t
    JOIN ledger_entries le ON le.transfer_id = t.transfer_id
    WHERE t.transfer_id = ${transferId}
  `;
  if (!rows.length) return null;
  return rowsToTransfer(rows);
}
