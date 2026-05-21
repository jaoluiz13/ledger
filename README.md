# Ledger — Double-Entry Bookkeeping at Scale

A high-throughput financial ledger built with **Fastify + postgres.js + PostgreSQL 16**, deployed on Kubernetes with PgBouncer connection pooling.

Starting point: **260 TPS**. After optimization: **~640 TPS** (2.5× improvement) with 100% success rate, running on a 3-replica Kubernetes cluster.

---

## What is this?

A **double-entry bookkeeping ledger** — the same accounting model used by banks and financial systems since the 15th century.

Every transfer between two accounts produces exactly two ledger entries whose sum is always zero:

```
Alice  –5 000  (debit)
Bob    +5 000  (credit)
─────────────
SUM  =     0  ✓
```

This invariant makes it impossible to create or destroy money accidentally. The `/reconcile` endpoint verifies it at any time.

---

## Stack

| Layer | Technology | Why |
|---|---|---|
| API | Fastify 5 | Fastest Node.js HTTP framework; schema-based serialization |
| DB client | postgres.js 3 | Direct PostgreSQL wire protocol; prepared statements; BigInt support |
| Database | PostgreSQL 16 | ACID, row-level locking, native UUID, BIGINT for cents |
| Connection pooler | PgBouncer | Session mode; multiplexes app connections to postgres |
| Runtime | Node.js 22 (ESM) | Native test runner; `--max-old-space-size` tuned per pod |
| Language | TypeScript | Strict types end-to-end; separate build/IDE tsconfigs |
| Orchestration | Kubernetes (kind) | 3-replica deployment; HPA; Kustomize overlays |
| GitOps | Argo CD | Continuous reconciliation from git |
| Load testing | k6 | `constant-arrival-rate` executor; p95/p99 thresholds |

> **Why no ORM?** Full control over SQL. No N+1 traps, no startup schema inference, no abstraction layer between the app and the wire protocol. postgres.js gives sub-millisecond overhead per query.

---

## Architecture

### Layer order

```
HTTP request
  → routes/        schema validation (Fastify + AJV) + handler binding
  → controllers/   HTTP parsing, BigInt↔Number conversion, response shaping
  → services/      business rules, idempotency check, transaction orchestration
  → repositories/  raw SQL via postgres.js
  → PostgreSQL      row-level locks, ACID transactions, WAL
```

### Infrastructure topology

```
                    ┌─────────────────────────────────┐
                    │         Kubernetes cluster        │
                    │                                   │
  k6 / client ──►  │  ┌──────────────────────────┐    │
  NodePort :30300   │  │   ledger-api (3 replicas) │    │
                    │  │   Fastify · Node.js 22    │    │
                    │  │   2 CPU · 1 Gi RAM        │    │
                    │  └──────────┬───────────────┘    │
                    │             │ pool: 50 conns/pod  │
                    │  ┌──────────▼───────────────┐    │
                    │  │   PgBouncer (2 replicas)  │    │
                    │  │   session mode            │    │
                    │  │   pool: 200 server conns  │    │
                    │  └──────────┬───────────────┘    │
                    │             │                     │
                    │  ┌──────────▼───────────────┐    │
                    │  │   PostgreSQL 16            │    │
                    │  │   4 CPU · 2 Gi RAM        │    │
                    │  │   shared_buffers=512MB     │    │
                    │  └───────────────────────────┘    │
                    └─────────────────────────────────┘
```

### Database schema

```
accounts
  id (bigint PK) · account_id (uuid, unique) · name
  balance (bigint, cents) · initial_balance (bigint)
  created_at · updated_at (auto-updated via trigger)

transfers
  id (bigint PK) · transfer_id (uuid, unique)
  from_account_id (uuid) · to_account_id (uuid)
  amount (bigint, cents > 0) · description
  idempotency_key (unique) · status · created_at

ledger_entries
  id (bigint PK) · ledger_entry_id (uuid, unique)
  account_id (uuid, FK) · transfer_id (uuid, FK)
  amount (bigint — positive = credit, negative = debit)
  created_at
```

---

## Key Design Decisions

### BigInt for money

All amounts are PostgreSQL `BIGINT` (cents). postgres.js maps BIGINT to JavaScript `BigInt` by default; this project overrides the type handler to use `Number` instead — avoiding BigInt serialization friction while keeping integer arithmetic. Floating-point is never used for monetary values.

### Transfer transaction flow

Each transfer runs inside a single `sql.begin()` transaction in exactly two database round-trips:

**Round-trip 1 — lock and validate:**
```sql
SELECT account_id, balance
FROM accounts
WHERE account_id = ANY($accounts)
ORDER BY account_id        -- deterministic order prevents deadlocks
FOR UPDATE
```

**Round-trip 2 — write everything atomically (CTE):**
```sql
WITH
  new_transfer AS (INSERT INTO transfers ... RETURNING ...),
  new_entries  AS (
    INSERT INTO ledger_entries
    SELECT v.aid, t.transfer_id, v.amt
    FROM new_transfer t
    CROSS JOIN (VALUES ($from, -$amount), ($to, $amount)) AS v(aid, amt)
    RETURNING ...
  ),
  _bal AS (
    UPDATE accounts
    SET balance = balance + CASE
      WHEN account_id = $from THEN -$amount::bigint
      WHEN account_id = $to   THEN  $amount::bigint
    END
    WHERE account_id = ANY(ARRAY[$from, $to]::uuid[])
  )
SELECT ... FROM new_transfer JOIN new_entries ON true
```

This collapses INSERT transfer + INSERT entries (×2) + UPDATE balances (×2) into a single round-trip, minimizing the time row locks are held.

### Idempotency — outside the transaction

The idempotency key lookup runs **before** opening the transaction:

```typescript
const existing = await transfersRepo.findByIdempotencyKey(idempotencyKey, sql);
if (existing) return existing;                 // no locks acquired

return sql.begin(async (tx) => { ... });       // only if new
```

Checking inside the transaction would hold locks even for duplicate requests. Race conditions (two identical requests arriving simultaneously) are caught by the `UNIQUE` constraint on `idempotency_key` — a `23505` error triggers a retry fetch.

### Deadlock prevention

Accounts are always locked in **alphabetical UUID order**. Two concurrent transfers involving the same pair of accounts always acquire locks in the same order, making circular waits impossible.

### PgBouncer — session mode

PgBouncer runs in `session` mode so postgres.js can use **prepared statements** (`prepare: true`). In transaction mode, prepared statements are destroyed between clients, forcing PostgreSQL to re-parse every query on every request.

`SERVER_RESET_QUERY = DISCARD ALL` cleans connection state when a server connection is returned to the pool.

### postgres.camel transform

postgres.js is configured with `transform: postgres.camel`, so all `snake_case` column names from PostgreSQL become `camelCase` in TypeScript automatically. Controllers re-snake fields when building HTTP responses.

---

## Performance Optimizations Applied

| # | Optimization | Impact |
|---|---|---|
| 1 | Idempotency check outside transaction | Eliminates unnecessary lock acquisition on duplicates |
| 2 | CTE: 3 DML ops in 1 round-trip | Reduced 5 sequential queries → 2 inside transaction |
| 3 | Batch balance update (`CASE WHEN`) | Eliminated 1 round-trip per transfer |
| 4 | `JOIN` in `findWithEntries` | Eliminated N+1 on transfer lookup |
| 5 | Prepared statements (`prepare: true`) | Eliminated per-request query parse + plan in PostgreSQL |
| 6 | PgBouncer session mode | Enabled prepared statements end-to-end |
| 7 | Fastify logger `level: warn` | Removed per-request log I/O from hot path |
| 8 | `keepAliveTimeout: 65000` | Reduced TCP connection churn at high TPS |
| 9 | PostgreSQL `synchronous_commit=off` | WAL acknowledged before disk flush (durability trade-off) |
| 10 | PostgreSQL `shared_buffers=512MB` | More data served from memory |
| 11 | Node.js `--max-old-space-size=768` | Prevents OOMKill under load; GC is predictable |
| 12 | K8s pod: 2 CPU / 1 Gi per replica | Headroom for GC and burst |
| 13 | K8s postgres: 4 CPU / 2 Gi | PostgreSQL WAL writer has dedicated resources |
| 14 | DB pool: 20 → 50 per pod | Reduces connection queue under burst |

### Performance evolution

| State | TPS | Notes |
|---|---|---|
| Baseline | ~260 TPS | Single transfer = 5 sequential queries, pool=20, no prepared statements |
| After code optimizations | ~537 TPS | CTE, idempotency outside tx, batch update |
| After infra + resources | ~643 TPS | Session mode, prepared statements, 4 CPU postgres, 2 CPU app |

Current bottleneck: **PostgreSQL WAL write throughput** on the kind cluster. Each transfer generates ~5 row-writes; at 643 TPS that is ~3 200 writes/second through a containerized filesystem. Increasing CPU/RAM has marginal effect at this point — the ceiling is I/O, not compute.

---

## Quick Start (local, no Docker for the app)

```bash
npm install

# Start postgres + pgbouncer
docker-compose up -d
npm run db:migrate

# Run with hot reload
npm run dev
# API at http://localhost:3000
```

> `DATABASE_URL` defaults to `postgresql://postgres:ledger@localhost:5432/ledger`. Set it to point at PgBouncer (`port 6432`) if you want to test with the pooler locally.

---

## Commands

```bash
npm run dev           # tsx watch — hot reload
npm run build         # tsc → dist/
npm run typecheck     # type-check src/ + tests/ (no emit)

npm run docker:up     # postgres + pgbouncer + app + migrate
npm run docker:down

npm run db:migrate    # apply migrations to running postgres container
npm run db:reset      # wipe volume, restart, re-migrate

npm test              # integration tests (truncates all tables in beforeEach)
npm run test:load     # k6 @ 400 TPS against localhost:3000
npm run test:load:nodeport      # k6 @ 400 TPS → K8s NodePort
npm run test:load:nodeport:1k   # k6 @ 1000 TPS → K8s NodePort
```

---

## API Reference

### `GET /health`
```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

### `POST /accounts`
```bash
curl -X POST http://localhost:3000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "initialBalance": 100000}'
# amount in cents — 100000 = R$ 1.000,00
```

### `GET /accounts/:id`
```bash
curl http://localhost:3000/accounts/<uuid>
```

### `POST /transfers`
```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Content-Type: application/json' \
  -d '{
    "fromAccountId":  "<uuid>",
    "toAccountId":    "<uuid>",
    "amount":         5000,
    "description":    "Payment",
    "idempotencyKey": "order-789-attempt-1"
  }'
```

Returns `201` with the transfer object and both ledger entries.  
Re-sending the same `idempotencyKey` returns the original transfer — no duplicate entries.

### `GET /accounts/:id/ledger?limit=20`
```bash
curl "http://localhost:3000/accounts/<uuid>/ledger?limit=20"
```

### `GET /accounts/:id/reconcile`
Computes `initial_balance + SUM(ledger_entries)` and compares it against `balance`. Returns `isConsistent: true/false` and `discrepancy`.

### `GET /reconcile`
Runs reconciliation for all accounts in one query.

---

## Kubernetes

### Kustomize overlays

```
k8s/
  base/               base manifests (deployment, service, statefulset, pgbouncer)
  overlays/
    dev/              kind cluster — local image, NodePort, relaxed resources
    prod/             production image, HPA (min 3, max 20 replicas, 70% CPU target)
```

### Deploy

```bash
# Dev (kind cluster)
kind load docker-image ledger:local --name ledger
kubectl apply -k k8s/overlays/dev

# Prod
kubectl apply -k k8s/overlays/prod
```

### HPA (dev overlay)

| Setting | Value |
|---|---|
| Min replicas | 3 |
| Max replicas | 12 |
| Scale-up trigger | 60% CPU utilization |

At 60% CPU per pod, there is headroom for GC pauses and burst traffic before the next replica comes up.

### PostgreSQL tuning (dev overlay)

```
synchronous_commit     = off      # acknowledge before WAL flush — trades durability for speed
shared_buffers         = 512MB    # 25% of 2 Gi pod memory
effective_cache_size   = 1536MB
wal_buffers            = 64MB
max_wal_size           = 2GB
checkpoint_completion_target = 0.9
work_mem               = 16MB
random_page_cost       = 1.1      # SSD-optimized planner cost
max_connections        = 300
log_min_duration_statement = 100  # log queries slower than 100ms
```

---

## Load Testing

```bash
# Requires k6 installed: https://k6.io/docs/get-started/installation/

# Against local Docker stack
npm run test:load

# Against K8s via NodePort (no port-forward overhead)
npm run test:load:nodeport      # 400 TPS, 5 000 accounts
npm run test:load:nodeport:1k   # 1 000 TPS, 5 000 accounts
```

The test (`tests/load/baseline.js`) uses a `constant-arrival-rate` executor — k6 fires exactly N requests per second regardless of VU availability, making it an honest measure of server throughput vs. a concurrency-bound test.

**Thresholds:**
- `http_req_duration p(95) < 300ms`
- `http_req_duration p(99) < 800ms`
- `http_req_failed rate < 1%`

---

## Testing

```bash
npm test
```

Integration tests use Node.js native test runner (`node --test`). Each test case runs inside a `beforeEach` that **truncates all tables** — requires a real PostgreSQL instance, never run against production.

`DATABASE_URL` env var must point to a running ledger database.
