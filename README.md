# Fastify Ledger — Phase 1

Scalable double-entry bookkeeping ledger built with **Fastify + postgres.js + PostgreSQL 16**.

Target: **100–200 TPS** baseline (Phase 1), road-mapped to 1 K TPS.

> **Why not an ORM?** To avoid ORM overhead and have full control over SQL. postgres.js talks directly to PostgreSQL wire protocol — no abstraction layer, no N+1 traps, no schema inference at startup.

---

## Stack

| Layer     | Choice                     | Why                                   |
| --------- | -------------------------- | ------------------------------------- |
| API       | Fastify 5                  | Fastest Node.js HTTP framework        |
| DB client | postgres.js 3              | Fastest PostgreSQL client for Node.js |
| Database  | PostgreSQL 16              | ACID, row-level locking, native UUID  |
| Language  | TypeScript (ESM)           | Type safety + modern module system    |
| Tests     | Node.js native test runner | Zero dependencies                     |
| Load test | k6                         | Industry standard, great metrics      |

---

## Quick Start

```bash
npm install
docker-compose up -d
npm run db:migrate
npm run dev
# API at http://localhost:3000
```

---

## API Reference

### Health

```bash
curl http://localhost:3000/health
```

### Create account

```bash
curl -X POST http://localhost:3000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "initialBalance": 100000}'
```

### Get account

```bash
curl http://localhost:3000/accounts/<uuid>
```

### Create transfer

```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Content-Type: application/json' \
  -d '{
    "fromAccountId": "<from-uuid>",
    "toAccountId":   "<to-uuid>",
    "amount":        5000,
    "description":   "Payment for services",
    "idempotencyKey": "unique-key-123"
  }'
```

### Ledger history

```bash
curl "http://localhost:3000/accounts/<uuid>/ledger?limit=20"
```

### Reconcile single account

```bash
curl http://localhost:3000/accounts/<uuid>/reconcile
```

### Reconcile all accounts

```bash
curl http://localhost:3000/reconcile
```

---

## Testing

```bash
# Unit tests (requires running PostgreSQL)
npm test

# Load test (requires running server + k6 installed)
npm run test:load
```

---

## Double-Entry Bookkeeping

Every transfer creates **exactly 2 ledger entries**:

```
Alice  –5 000  (debit)
Bob    +5 000  (credit)
─────────────
SUM  =     0  ✓ invariant
```

- `account.balance = SUM(ledger_entries.amount WHERE account_id = account.id)`
- The `/reconcile` endpoint verifies this invariant for every account.
- All transfers are **atomic transactions** — any failure rolls back both entries and both balance updates.

### Idempotency

Send the same `idempotencyKey` twice → same transfer is returned, no duplicate entries, no double-charge.

---

## Performance

### Baseline (Phase 1)

| Metric      | Target      |
| ----------- | ----------- |
| Throughput  | 100–200 RPS |
| p95 latency | < 100 ms    |
| p99 latency | < 200 ms    |
| Error rate  | < 1 %       |

Key design decisions:

- `FOR UPDATE` with deterministic lock ordering prevents deadlocks without sacrificing concurrency.
- Batch insert for ledger entries (`INSERT … VALUES (…), (…)`).
- Connection pool of 20 connections via postgres.js.
- Indexes on every hot column from day one.

### Roadmap

| Phase          | Goal      | Key changes                                               |
| -------------- | --------- | --------------------------------------------------------- |
| 2 — Optimised  | 500 RPS   | Larger pool, statement-level caching, prepared statements |
| 3 — Kubernetes | 1 000 RPS | Horizontal pod scaling, PgBouncer, read replicas          |

---

## Kubernetes + Argo CD

The repository now includes GitOps-ready deployment structure:

- `k8s/base`: base manifests (app, postgres, pgbouncer, services, secrets/config)
- `k8s/overlays/dev`: development overlay
- `k8s/overlays/prod`: production overlay + HPA
- `argocd/application-dev.yaml`: Argo CD application for dev
- `argocd/application-prod.yaml`: Argo CD application for prod

### 1. Required edits before deploy

1. Update API image in `k8s/base/app-deployment.yaml`:

```yaml
image: ghcr.io/your-org/ledger:latest
```

2. Update Argo CD `repoURL` in:

- `argocd/application-dev.yaml`
- `argocd/application-prod.yaml`

```yaml
repoURL: https://github.com/your-org/ledger.git
```

### 2. Manual deploy with kubectl

```bash
# Dev
kubectl apply -k k8s/overlays/dev

# Prod
kubectl apply -k k8s/overlays/prod
```

### 3. GitOps deploy with Argo CD

If Argo CD is already installed in the cluster:

```bash
# Dev
kubectl apply -f argocd/application-dev.yaml

# Prod
kubectl apply -f argocd/application-prod.yaml
```

Argo CD will continuously reconcile state from this repository.

### 4. Migration note

- SQL migrations were added to a ConfigMap and mounted into PostgreSQL init directory.
- For production schema evolution, prefer release-specific migration Jobs over only init scripts.

---

## Database Schema

```
accounts
  id (bigint PK) · account_id (uuid) · name · balance · created_at · updated_at

transfers
  id (bigint PK) · transfer_id (uuid) · from_account_id · to_account_id
  amount · description · idempotency_key (unique) · status · created_at

ledger_entries
  id (bigint PK) · ledger_entry_id (uuid) · account_id (FK) · transfer_id (FK)
  amount (+ credit / – debit) · created_at
```
