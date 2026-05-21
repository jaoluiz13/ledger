-- Ledger Phase 1: Double-Entry Bookkeeping Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  UUID NOT NULL DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  balance     BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_account_id ON accounts (account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts (name);

-- ============================================================
-- TRANSFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS transfers (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id      UUID NOT NULL DEFAULT gen_random_uuid(),
  from_account_id  UUID NOT NULL,
  to_account_id    UUID NOT NULL,
  amount           BIGINT NOT NULL CHECK (amount > 0),
  description      TEXT,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'completed',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_transfers_idempotency UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_transfer_id    ON transfers (transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from                  ON transfers (from_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to                    ON transfers (to_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_created               ON transfers (created_at DESC);

-- ============================================================
-- LEDGER ENTRIES (double-entry log)
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_entry_id  UUID NOT NULL DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL,
  transfer_id      UUID NOT NULL,
  amount           BIGINT NOT NULL,  -- positive = credit, negative = debit
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ledger_account  FOREIGN KEY (account_id)  REFERENCES accounts (account_id),
  CONSTRAINT fk_ledger_transfer FOREIGN KEY (transfer_id) REFERENCES transfers (transfer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_entry_id         ON ledger_entries (ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_created         ON ledger_entries (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transfer                ON ledger_entries (transfer_id);

-- ============================================================
-- updated_at trigger for accounts
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
