import * as accountsRepo from '../repositories/accounts.repository.js';
import type { Account, CreateAccountParams, ReconcileResult } from '../types/ledger.types.js';
import { LedgerError } from '../errors.js';

export async function createAccount(params: CreateAccountParams): Promise<Account> {
  const { name, initialBalance = 0 } = params;
  return accountsRepo.insert(name, initialBalance);
}

export async function getAccount(accountId: string): Promise<Account> {
  const account = await accountsRepo.findById(accountId);
  if (!account) throw new LedgerError('Account not found', 'ACCOUNT_NOT_FOUND', 404);
  return account;
}

export async function reconcileAccount(accountId: string): Promise<ReconcileResult> {
  const result = await accountsRepo.reconcileOne(accountId);
  if (!result) throw new LedgerError('Account not found', 'ACCOUNT_NOT_FOUND', 404);
  return result;
}

export async function reconcileAll(): Promise<ReconcileResult[]> {
  return accountsRepo.reconcileAll();
}
