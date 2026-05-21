const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const entryResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    account_id: { type: 'string' },
    transfer_id: { type: 'string' },
    amount: { type: 'number' },
    created_at: { type: 'string' },
  },
} as const;

export const createTransferSchema = {
  body: {
    type: 'object',
    required: ['fromAccountId', 'toAccountId', 'amount', 'idempotencyKey'],
    additionalProperties: false,
    properties: {
      fromAccountId: { type: 'string', pattern: UUID },
      toAccountId: { type: 'string', pattern: UUID },
      amount: { type: 'integer', minimum: 1 },
      description: { type: 'string', maxLength: 500 },
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 255 },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        from_account_id: { type: 'string' },
        to_account_id: { type: 'string' },
        amount: { type: 'number' },
        description: { type: 'string', nullable: true },
        idempotency_key: { type: 'string' },
        status: { type: 'string' },
        created_at: { type: 'string' },
        entries: { type: 'array', items: entryResponse },
      },
    },
  },
} as const;
