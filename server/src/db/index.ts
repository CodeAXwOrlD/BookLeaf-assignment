import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../config';
import { SCHEMA_SQL } from './schema';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: 'postgres' | 'pglite';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DATE_OID = 1082;
const INT8_OID = 20;

/**
 * One tiny adapter, two engines:
 *  - DATABASE_URL set  -> node-postgres Pool (Neon / Supabase / Render / RDS ...)
 *  - otherwise         -> PGlite, a real Postgres compiled to WASM that runs in-process.
 * Services only ever see `Db`, so there is no engine-specific code outside this file.
 * DATE columns are returned as 'YYYY-MM-DD' strings so we never hit timezone off-by-one bugs.
 */
export async function createDb(config: Pick<Config, 'databaseUrl' | 'pgliteDir'>): Promise<Db> {
  let db: Db;
  if (config.databaseUrl) {
    pg.types.setTypeParser(DATE_OID, (v) => v);
    pg.types.setTypeParser(INT8_OID, (v) => parseInt(v, 10));
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false },
    });
    db = {
      kind: 'postgres',
      async query(sql, params) {
        return (await pool.query(sql, params as any[])).rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: async (s, p) => (await client.query(s, p as any[])).rows });
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const inMemory = config.pgliteDir === 'memory';
    if (!inMemory) mkdirSync(dirname(config.pgliteDir), { recursive: true });
    const lite = new PGlite(inMemory ? undefined : config.pgliteDir);
    await lite.waitReady;
    // PGlite hands back JS Date objects for DATE columns; normalise to 'YYYY-MM-DD' like the pg path does.
    const rowsOf = (r: { rows: any[]; fields: { name: string; dataTypeID: number }[] }) => {
      const dateCols = r.fields.filter((f) => f.dataTypeID === DATE_OID).map((f) => f.name);
      if (!dateCols.length) return r.rows;
      return r.rows.map((row) => {
        for (const c of dateCols) if (row[c] instanceof Date) row[c] = row[c].toISOString().slice(0, 10);
        return row;
      });
    };
    db = {
      kind: 'pglite',
      async query(sql, params) {
        return rowsOf(await lite.query(sql, params as any[]));
      },
      async exec(sql) {
        await lite.exec(sql);
      },
      async tx(fn) {
        return lite.transaction((t) => fn({ query: async (s, p) => rowsOf(await t.query(s, p as any[])) }));
      },
      close: () => lite.close(),
    };
  }
  await db.exec(SCHEMA_SQL);
  return db;
}
