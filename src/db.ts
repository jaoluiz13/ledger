import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:ledger@localhost:5432/ledger';
const DB_POOL_MAX = Number(process.env.DB_POOL_MAX ?? '20');
const DB_IDLE_TIMEOUT = Number(process.env.DB_IDLE_TIMEOUT ?? '30');
const DB_CONNECT_TIMEOUT = Number(process.env.DB_CONNECT_TIMEOUT ?? '10');

export const sql = postgres(DATABASE_URL, {
  max: DB_POOL_MAX,
  idle_timeout: DB_IDLE_TIMEOUT,
  connect_timeout: DB_CONNECT_TIMEOUT,
  transform: postgres.camel,
  prepare: true,
  types: {
    // Parse PostgreSQL BIGINT (OID 20) as JS number instead of bigint
    bigint: {
      to: 20,
      from: [20],
      serialize: (x: number) => String(x),
      parse: (x: string) => Number(x),
    },
  },
});

// ISql is the common parent of both Sql and TransactionSql.
// Using the same TTypes keeps SQL parameters typed as number (not never).
export type Tx = postgres.ISql<{ bigint: number }>;

export async function closeDb(): Promise<void> {
  await sql.end();
}
