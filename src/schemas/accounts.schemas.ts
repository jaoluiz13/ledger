const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', pattern: UUID },
  },
} as const;

const accountResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    balance: { type: 'number' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const;

const ledgerEntryResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    account_id: { type: 'string' },
    transfer_id: { type: 'string' },
    amount: { type: 'number' },
    created_at: { type: 'string' },
  },
} as const;

const reconcileResponse = {
  type: 'object',
  properties: {
    accountId: { type: 'string' },
    name: { type: 'string' },
    storedBalance: { type: 'number' },
    calculatedBalance: { type: 'number' },
    isConsistent: { type: 'boolean' },
    discrepancy: { type: 'number' },
  },
} as const;

export const createAccountSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      initialBalance: { type: 'integer', minimum: 0 },
    },
  },
  response: { 201: accountResponse },
} as const;

export const getAccountSchema = {
  params: uuidParam,
  response: { 200: accountResponse },
} as const;

export const getLedgerSchema = {
  params: uuidParam,
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
    },
  },
  response: {
    200: { type: 'array', items: ledgerEntryResponse },
  },
} as const;

export const reconcileAccountSchema = {
  params: uuidParam,
  response: { 200: reconcileResponse },
} as const;

export const reconcileAllSchema = {
  response: {
    200: { type: 'array', items: reconcileResponse },
  },
} as const;
