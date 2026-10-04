import postgres, { type Sql } from 'postgres';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { deleteOrgObject } from '../../lib/object-store.ts';
import { firstForeignUpload, sweepUploadIntents } from './upload-intents.ts';

vi.mock('../../lib/object-store.ts', () => ({
  deleteOrgObject: vi.fn(() =>
    Promise.reject(new Error('synthetic store unavailable')),
  ),
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(() => Promise.resolve('synthetic')),
}));

const databaseUrl = process.env.ITEST_UPLOAD_INTENTS_DATABASE_URL;

function syntheticDatabaseTarget(raw: string): URL {
  const target = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.startsWith('/itest_upload_intents_') ||
    target.search !== ''
  ) {
    throw new Error(
      'Use a private local itest_upload_intents_ database without query parameters',
    );
  }
  return target;
}

describe('synthetic database target guard', () => {
  it.each([
    'postgres://localhost/itest_upload_intents_test?database=other_database',
    'postgres://localhost/itest_upload_intents_test?host=example.com',
    'postgres://example.com/itest_upload_intents_test',
    'postgres://localhost/production',
    'https://localhost/itest_upload_intents_test',
  ])('rejects unsafe target %s before connecting', (target) => {
    expect(() => syntheticDatabaseTarget(target)).toThrow();
  });
});

describe.runIf(databaseUrl)('upload-intent PostgreSQL substrate', () => {
  let sql: Sql;
  const statements: { query: string; parameters: unknown[] }[] = [];
  const scope = { organizationId: 'synthetic-org', userId: 'synthetic-user' };

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Missing synthetic database URL');
    const target = syntheticDatabaseTarget(databaseUrl);
    sql = postgres(databaseUrl, {
      max: 4,
      onnotice: () => undefined,
      debug: (_connection, query, parameters) => {
        statements.push({ query, parameters: [...parameters] });
      },
    });
    const [connected] = await sql<{ database: string }[]>`
      SELECT current_database() AS database
    `;
    if (connected?.database !== decodeURIComponent(target.pathname.slice(1))) {
      throw new Error(
        'Connected database does not match the validated synthetic target',
      );
    }
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS app;
      CREATE TABLE IF NOT EXISTS app.upload_intents (
        id text PRIMARY KEY, org_id text NOT NULL, user_id text NOT NULL,
        purpose text NOT NULL, s3_ref text UNIQUE NOT NULL,
        expires_at_ms bigint NOT NULL, consumed_at_ms bigint,
        bound_at_ms bigint, created_at_ms bigint NOT NULL
      );
      CREATE INDEX IF NOT EXISTS upload_intents_expiry ON app.upload_intents (org_id, expires_at_ms);
      CREATE TABLE IF NOT EXISTS app.file_metadata (org_id text, storage_ref text, uploaded_by text);
      CREATE TABLE IF NOT EXISTS app.documents (org_id text, file_ref text, history_files text[]);
      CREATE TABLE IF NOT EXISTS app.tasks (org_id text, attachments jsonb, outputs jsonb);
      CREATE TABLE IF NOT EXISTS app.conversation_messages (
        org_id text, direction text, delivery_state text, metadata jsonb
      );
      CREATE TABLE IF NOT EXISTS app.messages (org_id text, role text, parts jsonb);
    `);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await sql`TRUNCATE app.upload_intents, app.file_metadata, app.documents,
      app.tasks, app.conversation_messages, app.messages`;
    statements.length = 0;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('bounds actual holder subplans and rotates persistent failures behind held refs', async () => {
    await sql`
      INSERT INTO app.upload_intents
        (id, org_id, user_id, purpose, s3_ref, expires_at_ms, created_at_ms)
      SELECT 'intent-' || n, ${scope.organizationId}, ${scope.userId}, 'file',
        's3:blobs/synthetic/' || n, n, 0
      FROM generate_series(1, 1000) n
    `;
    await sql`
      INSERT INTO app.messages (org_id, role, parts)
      SELECT ${scope.organizationId}, 'user', jsonb_build_array(
        jsonb_build_object('type', 'attachment', 'fileId', 's3:blobs/synthetic/' || n))
      FROM generate_series(26, 1000) n
    `;
    await sweepUploadIntents(sql, scope);
    expect(deleteOrgObject).toHaveBeenCalledTimes(25);
    const bounded = statements.filter((statement) =>
      statement.query.includes('WITH candidates AS MATERIALIZED'),
    );
    expect(bounded).toHaveLength(2);
    for (const statement of bounded) {
      const explained = await sql.begin(async (tx) => {
        await tx`SAVEPOINT plan_probe`;
        const result = await tx.unsafe(
          `EXPLAIN (ANALYZE, FORMAT JSON) ${statement.query}`,
          statement.parameters as never[],
        );
        await tx`ROLLBACK TO SAVEPOINT plan_probe`;
        return result;
      });
      const serialized = JSON.stringify(explained);
      const loopCounts = [...serialized.matchAll(/"Actual Loops":(\d+)/g)].map(
        (match) => Number(match[1]),
      );
      expect(loopCounts.length).toBeGreaterThan(1);
      expect(Math.max(...loopCounts)).toBeLessThanOrEqual(25);
    }
    await sweepUploadIntents(sql, scope);
    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.upload_intents
    `;
    expect(remaining?.count).toBe(975);
    const removed = await sql`
      SELECT id FROM app.upload_intents
      WHERE expires_at_ms BETWEEN 26 AND 50
    `;
    expect(removed).toHaveLength(0);
    expect(deleteOrgObject).toHaveBeenCalledTimes(25);
    const [failed] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.upload_intents
      WHERE expires_at_ms > 1000 AND expires_at_ms < ${Date.now()}
    `;
    expect(failed?.count).toBe(25);
  });

  it('completes concurrent reversed-ref transactional proofs without deadlock', async () => {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION app.slow_intent_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.03);
        RETURN NEW;
      END $$;
      CREATE OR REPLACE TRIGGER slow_intent_lock BEFORE UPDATE ON app.upload_intents
        FOR EACH ROW EXECUTE FUNCTION app.slow_intent_lock();
    `);
    const refs = ['s3:blobs/synthetic/a', 's3:blobs/synthetic/b'];
    for (const [index, ref] of refs.entries()) {
      await sql`
        INSERT INTO app.upload_intents
          (id, org_id, user_id, purpose, s3_ref, expires_at_ms, created_at_ms)
        VALUES (${String(index)}, ${scope.organizationId}, ${scope.userId}, 'file',
          ${ref}, ${Date.now() + 60_000}, ${Date.now()})
      `;
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const results = await Promise.all([
        sql.begin(async (tx) => {
          await tx`SET LOCAL lock_timeout = '2s'`;
          return firstForeignUpload(tx, scope, refs);
        }),
        sql.begin(async (tx) => {
          await tx`SET LOCAL lock_timeout = '2s'`;
          return firstForeignUpload(tx, scope, [...refs].reverse());
        }),
      ]);
      expect(results).toEqual([null, null]);
    }
  });
});
