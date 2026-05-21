import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, getAccount, reconcileAccount } from '../src/services/accounts.service.js';
import { createTransfer } from '../src/services/transfers.service.js';
import { findByAccountId } from '../src/repositories/ledger-entries.repository.js';
import { LedgerError } from '../src/errors.js';
import { sql, closeDb } from '../src/db.js';

async function cleanDb() {
  await sql`TRUNCATE ledger_entries, transfers, accounts RESTART IDENTITY CASCADE`;
}

describe('Ledger Service', () => {
  before(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://postgres:ledger@localhost:5432/ledger';
  });

  after(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  // 1. Create account with initial balance
  it('creates account with initial balance', async () => {
    const account = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    assert.equal(account.name, 'Alice');
    assert.equal(account.balance, 100_000);
    assert.ok(account.id);
  });

  // 2. Create account with zero balance
  it('creates account with zero balance by default', async () => {
    const account = await createAccount({ name: 'Bob' });
    assert.equal(account.balance, 0);
  });

  // 3. Get account by ID
  it('retrieves account by id', async () => {
    const created = await createAccount({ name: 'Carol', initialBalance: 50_000 });
    const fetched = await getAccount(created.id);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.name, 'Carol');
    assert.equal(fetched.balance, 50_000);
  });

  // 4. Transfer creates exactly 2 ledger entries (debit + credit)
  it('transfer creates exactly 2 ledger entries', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob' });

    const transfer = await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 5_000,
      idempotencyKey: 'test-key-1',
    });

    assert.equal(transfer.entries.length, 2);

    const debit = transfer.entries.find((e) => e.amount < 0);
    const credit = transfer.entries.find((e) => e.amount > 0);
    assert.ok(debit);
    assert.ok(credit);
    assert.equal(debit!.amount, -5_000);
    assert.equal(credit!.amount, 5_000);
    assert.equal(debit!.accountId, alice.id);
    assert.equal(credit!.accountId, bob.id);
  });

  // 5. Transfer updates both account balances correctly
  it('transfer updates both account balances', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob', initialBalance: 20_000 });

    await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 30_000,
      idempotencyKey: 'test-key-2',
    });

    const updatedAlice = await getAccount(alice.id);
    const updatedBob = await getAccount(bob.id);
    assert.equal(updatedAlice.balance, 70_000);
    assert.equal(updatedBob.balance, 50_000);
  });

  // 6. Sum of entries for a transfer = 0 (double-entry invariant)
  it('sum of ledger entries for a transfer equals zero', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob' });

    const transfer = await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 7_777,
      idempotencyKey: 'test-key-3',
    });

    const sum = transfer.entries.reduce((acc, e) => acc + e.amount, 0);
    assert.equal(sum, 0);
  });

  // 7. Idempotency: duplicate key returns same transfer
  it('returns existing transfer for duplicate idempotency key', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob' });

    const first = await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 1_000,
      idempotencyKey: 'idem-key-1',
    });

    const second = await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 1_000,
      idempotencyKey: 'idem-key-1',
    });

    assert.equal(first.id, second.id);
  });

  // 8. Idempotency: no duplicate ledger entries created
  it('idempotent call does not create duplicate ledger entries', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob' });

    await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 2_000,
      idempotencyKey: 'idem-key-2',
    });
    await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 2_000,
      idempotencyKey: 'idem-key-2',
    });

    const entries = await findByAccountId(alice.id, 100);
    assert.equal(entries.length, 1, 'only one debit entry should exist');
  });

  // 9. Insufficient balance throws error
  it('throws INSUFFICIENT_BALANCE when source lacks funds', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100 });
    const bob = await createAccount({ name: 'Bob' });

    await assert.rejects(
      () => createTransfer({
        fromAccountId: alice.id,
        toAccountId: bob.id,
        amount: 1_000,
        idempotencyKey: 'test-key-4',
      }),
      (err: unknown) => {
        if (!(err instanceof LedgerError)) throw err;
        assert.equal(err.code, 'INSUFFICIENT_BALANCE');
        return true;
      },
    );
  });

  // 10. Transfer to same account throws error
  it('throws SAME_ACCOUNT when transferring to self', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });

    await assert.rejects(
      () => createTransfer({
        fromAccountId: alice.id,
        toAccountId: alice.id,
        amount: 1_000,
        idempotencyKey: 'test-key-5',
      }),
      (err: unknown) => {
        if (!(err instanceof LedgerError)) throw err;
        assert.equal(err.code, 'SAME_ACCOUNT');
        return true;
      },
    );
  });

  // 11. Reconciliation: stored balance = calculated balance
  it('reconciliation confirms stored balance matches ledger sum', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 100_000 });
    const bob = await createAccount({ name: 'Bob' });

    await createTransfer({
      fromAccountId: alice.id,
      toAccountId: bob.id,
      amount: 25_000,
      idempotencyKey: 'test-key-6',
    });

    const result = await reconcileAccount(alice.id);
    assert.equal(result.isConsistent, true);
    assert.equal(result.discrepancy, 0);
    assert.equal(result.storedBalance, 75_000);
    assert.equal(result.calculatedBalance, 75_000);
  });

  // 12. Atomic transaction: failure rolls back everything
  it('failed transfer rolls back atomically — no partial state', async () => {
    const alice = await createAccount({ name: 'Alice', initialBalance: 500 });
    const bob = await createAccount({ name: 'Bob' });

    try {
      await createTransfer({
        fromAccountId: alice.id,
        toAccountId: bob.id,
        amount: 1_000,
        idempotencyKey: 'test-key-7',
      });
    } catch {
      // expected
    }

    const updatedAlice = await getAccount(alice.id);
    const updatedBob = await getAccount(bob.id);
    const aliceEntries = await findByAccountId(alice.id, 100);
    const bobEntries = await findByAccountId(bob.id, 100);

    assert.equal(updatedAlice.balance, 500);
    assert.equal(updatedBob.balance, 0);
    assert.equal(aliceEntries.length, 0);
    assert.equal(bobEntries.length, 0);
  });
});
