ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS initial_balance BIGINT NOT NULL DEFAULT 0;

-- Back-fill: for existing rows, initial_balance = balance − sum of ledger entries
UPDATE accounts a
SET initial_balance = a.balance - COALESCE((
  SELECT SUM(le.amount)
  FROM ledger_entries le
  WHERE le.account_id = a.account_id
), 0);
