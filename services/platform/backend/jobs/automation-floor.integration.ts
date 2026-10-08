/** CLI floor query proof on a separately owned database. The integration user
 * needs CREATE DATABASE, as for the legacy writer cutover proof. No psql binary
 * or Docker host access is required; the CLI's real bounded psql transport has
 * separate command tests. */
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';

import postgres, { type Sql } from 'postgres';

import {
  AUTOMATION_CUTOVER_CENSUS_SQL,
  AUTOMATION_CUTOVER_ISOLATION,
  AUTOMATION_CUTOVER_LOCK_SQL,
  AUTOMATION_CUTOVER_PROBE_SQL,
  AUTOMATION_CUTOVER_SESSION_SQL,
  cutoverLockOwned,
  emptyLegacyCutoverCensus,
} from '../../../../tools/cli/src/lib/deployment/automation-cutover-sql.ts';
import {
  AUTOMATION_LEDGER_QUERY,
  automationFloor,
  checkedAutomationLedgerQuery,
} from '../../../../tools/cli/src/lib/deployment/automation-floor.ts';
import { AUTOMATION_PROTOCOL_MIGRATION } from '../../../../tools/cli/src/lib/deployment/automation-model.ts';
import { resolvePostgresConnection } from '../db/ssl.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

async function ledgerValue(reader: Pick<Sql, 'unsafe'>): Promise<unknown> {
  const rows = await reader.unsafe(AUTOMATION_LEDGER_QUERY).values();
  if (rows.length !== 1 || rows[0].length !== 1)
    throw new Error('Unexpected catalog census');
  const statement = checkedAutomationLedgerQuery(rows[0][0]);
  const result = await reader.unsafe(statement).values();
  if (result.length !== 1 || result[0].length !== 1)
    throw new Error('Unexpected ledger census');
  return result[0][0];
}

/** The actual CLI SQL is exercised in the required Backend integration lane,
 * in this helper's owned database, with a separate competing connection. */
async function checkCutover(
  db: Sql,
  peer: Sql,
  record: Recorder,
): Promise<void> {
  const ids = readdirSync(new URL('../db/migrations/', import.meta.url))
    .filter(
      (name) =>
        /^\d{4}_[a-z0-9_]+\.(sql|ts)$/.test(name) &&
        Number(name.slice(0, 4)) <= 153,
    )
    .sort();
  await db`ALTER TABLE tale.app_migrations ADD PRIMARY KEY (name)`;
  await db`DELETE FROM tale.app_migrations`;
  await db`INSERT INTO tale.app_migrations ${db(ids.map((name) => ({ name })))}`;
  await db`CREATE SCHEMA app`;
  await db`CREATE TABLE app.automation_runs (id text PRIMARY KEY, org_id text NOT NULL, status text NOT NULL)`;
  const census = async (tx: Pick<Sql, 'unsafe'>) => {
    const ledger = await ledgerValue(tx);
    const result = await tx.unsafe(AUTOMATION_CUTOVER_CENSUS_SQL).values();
    if (result.length !== 1 || result[0].length !== 1)
      throw new Error('Unexpected cutover census');
    return emptyLegacyCutoverCensus(
      `${JSON.stringify(ledger)}\n${JSON.stringify(result[0][0])}`,
    );
  };
  await db.begin(AUTOMATION_CUTOVER_ISOLATION, async (tx) => {
    await tx.unsafe(AUTOMATION_CUTOVER_SESSION_SQL);
    await tx.unsafe(AUTOMATION_CUTOVER_LOCK_SQL);
    record(
      'automation cutover holds the exact legacy all-org zero census',
      await census(tx),
      'source ledger and owned SHARE lock',
    );
    let blocked = false;
    try {
      await peer.begin(async (writer) => {
        await writer`SET LOCAL statement_timeout = '300ms'`;
        await writer`INSERT INTO app.automation_runs VALUES ('competing', 'second-org', 'queued')`;
      });
    } catch (error) {
      blocked =
        error instanceof postgres.PostgresError && error.code === '57014';
    }
    const [count] =
      await tx`SELECT count(*)::int AS value FROM app.automation_runs`;
    record(
      'automation cutover blocks a competing legacy admission while zero is held',
      blocked && count.value === 0,
      'competing INSERT hit its statement bound; zero retained',
    );
  });
  await peer`INSERT INTO app.automation_runs VALUES ('after-release', 'second-org', 'queued')`;
  await db.begin(AUTOMATION_CUTOVER_ISOLATION, async (tx) => {
    await tx.unsafe(AUTOMATION_CUTOVER_SESSION_SQL);
    await tx.unsafe(AUTOMATION_CUTOVER_LOCK_SQL);
    record(
      'automation cutover refuses unfinished work in another organization',
      !(await census(tx)),
      'released lock permits admission; the next census refuses',
    );
  });
  await peer`DELETE FROM app.automation_runs`;
  await peer.begin(async (writer) => {
    await writer`INSERT INTO app.automation_runs VALUES ('uncommitted', 'second-org', 'queued')`;
    let refused = false;
    try {
      await db.begin(AUTOMATION_CUTOVER_ISOLATION, async (tx) => {
        await tx.unsafe(AUTOMATION_CUTOVER_SESSION_SQL);
        await tx.unsafe(AUTOMATION_CUTOVER_LOCK_SQL);
      });
    } catch (error) {
      refused =
        error instanceof postgres.PostgresError && error.code === '55P03';
    }
    record(
      'automation cutover refuses a prior uncommitted admission',
      refused,
      'NOWAIT never manufactures zero by stopping its writer',
    );
    await writer`DELETE FROM app.automation_runs WHERE id = 'uncommitted'`;
  });
  let revoked = false;
  let lost = false;
  try {
    await db.begin(AUTOMATION_CUTOVER_ISOLATION, async (tx) => {
      await tx.unsafe(AUTOMATION_CUTOVER_SESSION_SQL);
      await tx.unsafe(AUTOMATION_CUTOVER_LOCK_SQL);
      const [owner] = await tx`SELECT pg_backend_pid() AS pid`;
      await peer`SELECT pg_terminate_backend(${owner.pid})`;
      try {
        const result = await tx.unsafe(AUTOMATION_CUTOVER_PROBE_SQL).values();
        revoked = !cutoverLockOwned(JSON.stringify(result[0]?.[0]));
      } catch {
        revoked = true;
      }
    });
  } catch {
    lost = true;
  }
  record(
    'automation cutover session loss revokes its lock proof',
    revoked && lost,
    'terminated only this owned transaction; no stale zero is authority',
  );
}

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
  let peer: Sql | undefined;
  let failure: unknown;
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    owned = true;
    sql = connect(target.toString());
    peer = connect(target.toString());
    const db = sql;
    const read = () =>
      db.begin('read only', async (tx) => {
        // A returned string is not authority to execute SQL. Admit only the exact
        // fixed SELECT the source query can generate, including its null refusal.
        const result = await ledgerValue(tx);
        try {
          return automationFloor(JSON.stringify(result));
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
    await checkCutover(db, peer, record);
  } catch (error) {
    failure = error;
  } finally {
    // Stop only our connection before dropping only our successfully created DB.
    // A failed shutdown leaves that owned DB for diagnosis; never FORCE others.
    let stopped = sql === undefined;
    try {
      await Promise.all([sql?.end({ timeout: 8 }), peer?.end({ timeout: 8 })]);
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
