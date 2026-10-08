/** CLI floor query proof on a separately owned database. The integration user
 * needs CREATE DATABASE, as for the legacy writer cutover proof. No psql binary
 * or Docker host access is required; the CLI's real bounded psql transport has
 * separate command tests. */
import { randomUUID } from 'node:crypto';

import postgres, { type Sql } from 'postgres';

import {
  AUTOMATION_LEDGER_QUERY,
  automationFloor,
  checkedAutomationLedgerQuery,
} from '../../../../tools/cli/src/lib/deployment/automation-floor.ts';
import { AUTOMATION_PROTOCOL_MIGRATION } from '../../../../tools/cli/src/lib/deployment/automation-model.ts';
import { resolvePostgresConnection } from '../db/ssl.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

function connect(raw: string): Sql {
  const url = new URL(raw);
  url.searchParams.set(
    'options',
    '-c statement_timeout=8000 -c lock_timeout=8000 -c idle_in_transaction_session_timeout=8000',
  );
  const resolved = resolvePostgresConnection(url.toString());
  return postgres(resolved.url, {
    ssl: resolved.ssl,
    max: 1,
    connect_timeout: 8,
    onnotice: () => {},
  });
}

export async function checkAutomationProtocolFloor(
  databaseUrl: string,
  record: Recorder,
): Promise<void> {
  const admin = connect(databaseUrl);
  const name = `itest_floor_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  let owned = false;
  let sql: Sql | undefined;
  let failure: unknown;
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    owned = true;
    sql = connect(target.toString());
    const db = sql;
    const read = () =>
      db.begin('read only', async (tx) => {
        const rows = await tx.unsafe(AUTOMATION_LEDGER_QUERY).values();
        if (rows.length !== 1 || rows[0].length !== 1)
          throw new Error('Unexpected catalog census');
        // A returned string is not authority to execute SQL. Admit only the exact
        // fixed SELECT the source query can generate, including its null refusal.
        const statement = checkedAutomationLedgerQuery(rows[0][0]);
        const result = await tx.unsafe(statement).values();
        if (result.length !== 1 || result[0].length !== 1)
          throw new Error('Unexpected ledger census');
        try {
          return automationFloor(JSON.stringify(result[0][0]));
        } catch {
          return null;
        }
      });
    const prove = async (label: string, expected: 1 | 2 | null) => {
      const actual = await read();
      record(
        label,
        actual === expected,
        `observed floor=${actual}; expected=${expected}`,
      );
    };
    await prove('automation floor refuses a missing ledger', null);
    await db`CREATE TABLE public.app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    await db`INSERT INTO public.app_migrations (name) VALUES ('0001_initial.sql')`;
    await prove(
      'automation floor retains legacy protocol on the valid public ledger',
      1,
    );
    await db`INSERT INTO public.app_migrations (name) VALUES (${AUTOMATION_PROTOCOL_MIGRATION})`;
    await prove(
      'automation floor observes the committed protocol migration',
      2,
    );
    await db`CREATE SCHEMA tale`;
    await db`ALTER TABLE public.app_migrations SET SCHEMA tale`;
    await db`SET search_path TO tale, public`;
    await prove(
      'automation floor discovers the actual tale ledger independently of search_path',
      2,
    );
    await db`CREATE TABLE public.app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    await db`INSERT INTO public.app_migrations (name) VALUES ('0001_initial.sql')`;
    await db`SET search_path TO public`;
    await prove('automation floor refuses a shadow legacy ledger', null);
    await db`DROP TABLE public.app_migrations`;
    await db`ALTER TABLE tale.app_migrations ENABLE ROW LEVEL SECURITY`;
    await prove(
      'automation floor refuses row-filtered metadata even for a superuser reader',
      null,
    );
    await db`ALTER TABLE tale.app_migrations DISABLE ROW LEVEL SECURITY`;
    await db`ALTER TABLE tale.app_migrations DROP CONSTRAINT app_migrations_pkey`;
    await prove('automation floor refuses malformed ledger identity', null);
  } catch (error) {
    failure = error;
  } finally {
    // Stop only our connection before dropping only our successfully created DB.
    // A failed shutdown leaves that owned DB for diagnosis; never FORCE others.
    let stopped = sql === undefined;
    try {
      await sql?.end({ timeout: 8 });
      stopped = true;
    } catch (error) {
      failure ??= error;
    }
    if (owned && stopped) {
      try {
        await admin`DROP DATABASE ${admin(name)}`;
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      await admin.end({ timeout: 8 });
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}
