# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (local, no Docker for the app)
npm run dev           # tsx watch — hot reload, no build step needed
npm run typecheck     # type-check src/ + tests/ without emitting

# Build
npm run build         # tsc -p tsconfig.build.json → dist/

# Docker (full stack: postgres + app)
npm run docker:up     # docker-compose up -d + db:migrate
npm run docker:down   # docker-compose down
npm run docker:logs   # follow app container logs

# Database only
npm run db:migrate    # apply migrations/001_init.sql to ledger-postgres container
npm run db:reset      # wipe volume, restart postgres only, re-migrate

# Tests (requires Node >=20 and a running PostgreSQL with ledger database)
npm test                          # all tests via node --test
node --import tsx/esm --test tests/ledger.test.ts  # same, explicit
npm run test:load                 # k6 load test (requires running server + k6 CLI)
```

`DATABASE_URL` must be set (or default `postgresql://postgres:ledger@localhost:5432/ledger` is used). The test suite **truncates all tables** in `beforeEach` — never point it at a production database.

## Architecture

### Layer order

```
HTTP request
  → routes/       (schema validation + handler binding)
  → controllers/  (HTTP parsing, BigInt↔Number conversion, response shaping)
  → services/     (business rules, transaction orchestration)
  → repositories/ (raw SQL via postgres.js)
```

### Key design decisions

**Double-entry bookkeeping invariant:** every transfer produces exactly 2 `ledger_entries` rows — a debit (`-amount`) on the source and a credit (`+amount`) on the destination. Their sum is always 0. `account.balance` must equal `SUM(ledger_entries.amount)` for that account, verified by `GET /accounts/:id/reconcile`.

**Transaction flow in `transfers.service.ts`:**
1. Idempotency check — if `idempotency_key` exists, return the existing transfer without side-effects.
2. `SELECT … FOR UPDATE` on both accounts in **alphabetical UUID order** to prevent deadlocks.
3. Insert transfer record → batch-insert 2 ledger entries → update both balances. All inside `sql.begin()`.

**`postgres.camel` transform:** postgres.js is configured with `transform: postgres.camel`, so all snake_case column names returned from PostgreSQL become camelCase in TypeScript. Controllers explicitly re-snake the fields when building HTTP responses (e.g. `from_account_id`, `created_at`).

**`Tx` type:** transaction callbacks in `sql.begin(tx => …)` receive a `TransactionSql` object. It is typed as `typeof sql` (`Tx`) throughout — structurally compatible and simpler than importing postgres internals.

**BigInt for money:** all amounts are PostgreSQL `BIGINT` (cents). postgres.js maps these to JavaScript `BigInt`. Controllers call `Number()` only at the serialization boundary. Never use floating-point arithmetic on amounts.

**Schema validation:** JSON Schema objects live in `src/schemas/`. Fastify validates and coerces before the controller runs. Response schemas also enable `fast-json-stringify`. Validation errors are normalized to `{ error, code: "VALIDATION_ERROR" }` in the central error handler in `server.ts`.

### tsconfig split

| File | Purpose |
|---|---|
| `tsconfig.json` | IDE / `typecheck` — includes `src/` and `tests/`, `noEmit: true` |
| `tsconfig.build.json` | `npm run build` — includes only `src/`, emits to `dist/` |

### Database schema

Each table has a surrogate `BIGINT` PK for internal joins and a `UUID` as the public identifier exposed in the API. Migrations live in `migrations/001_init.sql` and are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
