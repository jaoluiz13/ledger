export interface Account {
  id: string;
  name: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  transferId: string;
  amount: number;
  createdAt: Date;
}

export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description: string | null;
  idempotencyKey: string;
  status: string;
  createdAt: Date;
  entries: LedgerEntry[];
}

export interface ReconcileResult {
  accountId: string;
  name: string;
  storedBalance: number;
  calculatedBalance: number;
  isConsistent: boolean;
  discrepancy: number;
}

export interface CreateAccountParams {
  name: string;
  initialBalance?: number;
}

export interface CreateTransferParams {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
  idempotencyKey: string;
}
