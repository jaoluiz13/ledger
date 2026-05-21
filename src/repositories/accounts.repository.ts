import { sql, type Tx } from '../db.js';
import type { Account, ReconcileResult } from '../types/ledger.types.js';

export async function findById(accountId: string, tx: Tx = sql): Promise<Account | null> {
  const [row] = await tx<Account[]>`
    SELECT account_id AS id, name, balance, created_at, updated_at
    FROM accounts
    WHERE account_id = ${accountId}
  `;
  return row ?? null;
}

// Locks rows in deterministic order to prevent deadlocks in concurrent transfers
export async function lockManyForUpdate(
  ids: [string, string],
  tx: Tx,
): Promise<Array<{ accountId: string; balance: number }>> {
  return tx<Array<{ accountId: string; balance: number }>>`
    SELECT account_id, balance
    FROM accounts
    WHERE account_id = ANY(${ids})
    ORDER BY account_id
    FOR UPDATE
  `;
}

export async function insert(name: string, balance: number, tx: Tx = sql): Promise<Account> {
  const [row] = await tx<Account[]>`
    INSERT INTO accounts (name, balance, initial_balance)
    VALUES (${name}, ${balance}, ${balance})
    RETURNING account_id AS id, name, balance, created_at, updated_at
  `;
  return row;
}

export async function incrementBalance(accountId: string, delta: number, tx: Tx): Promise<void> {
  await tx`
    UPDATE accounts SET balance = balance + ${delta} WHERE account_id = ${accountId}
  `;
}

export async function incrementBalanceBatch(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  tx: Tx,
): Promise<void> {
  await tx`
    UPDATE accounts
    SET balance = balance + CASE
      WHEN account_id = ${fromAccountId} THEN ${-amount}::bigint
      WHEN account_id = ${toAccountId}   THEN ${amount}::bigint
    END
    WHERE account_id = ANY(ARRAY[${fromAccountId}, ${toAccountId}]::uuid[])
  `;
}

export async function reconcileOne(accountId: string): Promise<ReconcileResult | null> {
  const [row] = await sql<Array<{
    accountId: string;
    name: string;
    storedBalance: number;
    calculatedBalance: number;
  }>>`
    SELECT
      a.account_id                                          AS "accountId",
      a.name,
      a.balance                                             AS "storedBalance",
      a.initial_balance + COALESCE(SUM(le.amount), 0)      AS "calculatedBalance"
    FROM accounts a
    LEFT JOIN ledger_entries le ON le.account_id = a.account_id
    WHERE a.account_id = ${accountId}
    GROUP BY a.account_id, a.name, a.balance, a.initial_balance
  `;
  if (!row) return null;
  const discrepancy = row.storedBalance - row.calculatedBalance;
  return { ...row, isConsistent: discrepancy === 0, discrepancy };
}

export async function reconcileAll(): Promise<ReconcileResult[]> {
  const rows = await sql<Array<{
    accountId: string;
    name: string;
    storedBalance: number;
    calculatedBalance: number;
  }>>`
    SELECT
      a.account_id                                          AS "accountId",
      a.name,
      a.balance                                             AS "storedBalance",
      a.initial_balance + COALESCE(SUM(le.amount), 0)      AS "calculatedBalance"
    FROM accounts a
    LEFT JOIN ledger_entries le ON le.account_id = a.account_id
    GROUP BY a.account_id, a.name, a.balance, a.initial_balance
    ORDER BY a.account_id
  `;
  return rows.map((row) => {
    const discrepancy = row.storedBalance - row.calculatedBalance;
    return { ...row, isConsistent: discrepancy === 0, discrepancy };
  });
}
