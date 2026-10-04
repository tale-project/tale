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
import { blobRefHeld, listedBlobRefHeld } from './blob-holders.ts';
import { preserveChatAttachmentOwnership } from './chat-ownership.ts';
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
      ALTER TABLE app.file_metadata ADD COLUMN IF NOT EXISTS id text;
      ALTER TABLE app.file_metadata ADD COLUMN IF NOT EXISTS document_id text;
      ALTER TABLE app.file_metadata ADD COLUMN IF NOT EXISTS thread_id text;
      CREATE TABLE IF NOT EXISTS app.documents (org_id text, file_ref text, history_files text[]);
      CREATE TABLE IF NOT EXISTS app.tasks (org_id text, attachments jsonb, outputs jsonb);
      CREATE TABLE IF NOT EXISTS app.conversation_messages (
        org_id text, direction text, delivery_state text, metadata jsonb
      );
      ALTER TABLE app.conversation_messages ADD COLUMN IF NOT EXISTS channel text;
      ALTER TABLE app.conversation_messages ADD COLUMN IF NOT EXISTS conversation_id text;
      CREATE TABLE IF NOT EXISTS app.conversation_api_bindings (org_id text, conversation_id text, source_deleted boolean);
      CREATE TABLE IF NOT EXISTS app.messages (org_id text, role text, parts jsonb);
      ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS thread_id text;
      ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS attachment_ownership jsonb;
      CREATE TABLE IF NOT EXISTS app.thread_metadata (
        org_id text, thread_id text, user_id text, branch_root_id text
      );
      CREATE TABLE IF NOT EXISTS app.blob_composer_handoffs (
        org_id text NOT NULL, user_id text NOT NULL, storage_ref text NOT NULL,
        expires_at_ms bigint NOT NULL, PRIMARY KEY (org_id, user_id, storage_ref)
      );
    `);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await sql`TRUNCATE app.upload_intents, app.file_metadata, app.documents,
      app.tasks, app.conversation_messages, app.messages,
      app.thread_metadata, app.blob_composer_handoffs, app.conversation_api_bindings`;
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
      INSERT INTO app.messages (org_id, role, parts, attachment_ownership)
      SELECT ${scope.organizationId}, 'user', jsonb_build_array(
        jsonb_build_object('type', 'attachment', 'fileId', 's3:blobs/synthetic/' || n)),
        jsonb_build_object('s3:blobs/synthetic/' || n, jsonb_build_object('owned', true))
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

  it.each([
    {
      name: 'author upload',
      uploader: 'synthetic-user',
      fileThread: null,
      document: null,
      expected: true,
    },
    {
      name: 'thread upload',
      uploader: 'other-user',
      fileThread: 'thread',
      document: null,
      expected: true,
    },
    {
      name: 'branch-root upload',
      uploader: 'other-user',
      fileThread: 'root',
      document: null,
      expected: true,
    },
    {
      name: 'unrelated upload',
      uploader: 'other-user',
      fileThread: 'other-thread',
      document: null,
      expected: false,
    },
    {
      name: 'borrowed document attachment',
      uploader: 'other-user',
      fileThread: null,
      document: 'document',
      expected: false,
    },
    {
      name: 'author document attachment',
      uploader: 'synthetic-user',
      fileThread: 'thread',
      document: 'document',
      expected: false,
    },
  ])(
    'preserves only independent ownership for $name after file deletion',
    async ({ uploader, fileThread, document, expected }) => {
      const ref = 's3:blobs/synthetic/attachment';
      await sql`INSERT INTO app.thread_metadata (org_id, thread_id, user_id, branch_root_id)
      VALUES (${scope.organizationId}, 'thread', ${scope.userId}, 'root')`;
      await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, uploaded_by, document_id, thread_id)
      VALUES ('file', ${scope.organizationId}, ${ref}, ${uploader}, ${document}, ${fileThread})`;
      await sql`INSERT INTO app.messages (org_id, thread_id, role, parts)
      VALUES (${scope.organizationId}, 'thread', 'user',
        jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', ${ref}::text)))`;
      const verdict = async () => {
        const [row] = await sql<
          { held: boolean }[]
        >`SELECT ${listedBlobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
        return row?.held;
      };
      expect(await verdict()).toBe(expected);
      await preserveChatAttachmentOwnership(sql, scope.organizationId, ref);
      const [message] = await sql<
        { ownership: unknown }[]
      >`SELECT attachment_ownership AS ownership FROM app.messages`;
      expect(message?.ownership).toEqual({
        [ref]: expected
          ? { owned: true }
          : document
            ? { documentId: document }
            : { fileId: 'file' },
      });
      await sql`DELETE FROM app.file_metadata WHERE org_id = ${scope.organizationId} AND storage_ref = ${ref}`;
      expect(await verdict()).toBe(expected);
    },
  );

  it('does not promote recorded document provenance through a later matching upload', async () => {
    const ref = 's3:blobs/synthetic/borrowed';
    await sql`INSERT INTO app.thread_metadata (org_id, thread_id, user_id)
      VALUES (${scope.organizationId}, 'thread', ${scope.userId})`;
    await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, uploaded_by)
      VALUES ('file', ${scope.organizationId}, ${ref}, ${scope.userId})`;
    await sql`INSERT INTO app.messages (org_id, thread_id, role, parts, attachment_ownership)
      VALUES (${scope.organizationId}, 'thread', 'user',
        jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', ${ref}::text)),
        jsonb_build_object(${ref}::text, jsonb_build_object('documentId', 'destroyed-document')))`;
    await preserveChatAttachmentOwnership(sql, scope.organizationId, ref);
    const [row] = await sql<
      { held: boolean }[]
    >`SELECT ${listedBlobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
    expect(row?.held).toBe(false);
  });

  it.each([
    {
      name: 'foreign message',
      messageOrg: 'other-org',
      threadOrg: 'synthetic-org',
      fileOrg: 'synthetic-org',
      role: 'user',
    },
    {
      name: 'foreign thread',
      messageOrg: 'synthetic-org',
      threadOrg: 'other-org',
      fileOrg: 'synthetic-org',
      role: 'user',
    },
    {
      name: 'foreign file',
      messageOrg: 'synthetic-org',
      threadOrg: 'synthetic-org',
      fileOrg: 'other-org',
      role: 'user',
    },
    {
      name: 'assistant attachment',
      messageOrg: 'synthetic-org',
      threadOrg: 'synthetic-org',
      fileOrg: 'synthetic-org',
      role: 'assistant',
    },
  ])(
    'rejects $name as an independent holder',
    async ({ messageOrg, threadOrg, fileOrg, role }) => {
      const ref = 's3:blobs/synthetic/scoped';
      await sql`INSERT INTO app.thread_metadata (org_id, thread_id, user_id)
      VALUES (${threadOrg}, 'thread', ${scope.userId})`;
      await sql`INSERT INTO app.file_metadata (org_id, storage_ref, uploaded_by)
      VALUES (${fileOrg}, ${ref}, ${scope.userId})`;
      await sql`INSERT INTO app.messages (org_id, thread_id, role, parts)
      VALUES (${messageOrg}, 'thread', ${role},
        jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', ${ref}::text)))`;
      const [row] = await sql<
        { held: boolean }[]
      >`SELECT ${listedBlobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
      expect(row?.held).toBe(false);
    },
  );

  it.each([
    {
      name: 'live local',
      organizationId: 'synthetic-org',
      expiresIn: 60_000,
      expected: true,
    },
    {
      name: 'expired local',
      organizationId: 'synthetic-org',
      expiresIn: -60_000,
      expected: false,
    },
    {
      name: 'live foreign',
      organizationId: 'other-org',
      expiresIn: 60_000,
      expected: false,
    },
  ])(
    'holds a composer handoff only when $name',
    async ({ organizationId, expiresIn, expected }) => {
      const ref = 's3:blobs/synthetic/handoff';
      await sql`INSERT INTO app.blob_composer_handoffs (org_id, user_id, storage_ref, expires_at_ms)
      VALUES (${organizationId}, ${scope.userId}, ${ref}, ${Date.now() + expiresIn})`;
      const [row] = await sql<
        { held: boolean }[]
      >`SELECT ${blobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
      expect(row?.held).toBe(expected);
    },
  );

  it.each(
    ['queued', 'failed'].flatMap((deliveryState) => [
      {
        name: 'closed API source',
        deliveryState,
        channel: 'api',
        bindingOrg: 'synthetic-org',
        bindingConversation: 'conversation',
        deleted: true,
        expected: true,
      },
      {
        name: 'live API source',
        deliveryState,
        channel: 'api',
        bindingOrg: 'synthetic-org',
        bindingConversation: 'conversation',
        deleted: false,
        expected: true,
      },
      {
        name: 'foreign closed API source',
        deliveryState,
        channel: 'api',
        bindingOrg: 'other-org',
        bindingConversation: 'conversation',
        deleted: true,
        expected: true,
      },
      {
        name: 'different closed API conversation',
        deliveryState,
        channel: 'api',
        bindingOrg: 'synthetic-org',
        bindingConversation: 'other-conversation',
        deleted: true,
        expected: true,
      },
      {
        name: 'email beside closed API source',
        deliveryState,
        channel: 'email',
        bindingOrg: 'synthetic-org',
        bindingConversation: 'conversation',
        deleted: true,
        expected: true,
      },
    ]),
  )(
    '$deliveryState mail with $name has held=$expected',
    async ({
      deliveryState,
      channel,
      bindingOrg,
      bindingConversation,
      deleted,
      expected,
    }) => {
      const ref = 's3:blobs/synthetic/api-attachment';
      await sql`INSERT INTO app.conversation_api_bindings (org_id, conversation_id, source_deleted)
      VALUES (${bindingOrg}, ${bindingConversation}, ${deleted})`;
      await sql`INSERT INTO app.conversation_messages (org_id, conversation_id, channel, direction, delivery_state, metadata)
      VALUES (${scope.organizationId}, 'conversation', ${channel}, 'outbound', ${deliveryState},
        jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('storageId', ${ref}::text))))`;
      const [row] = await sql<{ listed: boolean; held: boolean }[]>`
      SELECT ${listedBlobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS listed,
        ${blobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
      expect(row).toEqual({ listed: expected, held: expected });
    },
  );

  it.each(['queued', 'failed'])(
    'keeps a native %s reply held after receipt-owned snapshot removal until acknowledgement',
    async (deliveryState) => {
      const ref = 's3:blobs/synthetic/closed-attachment';
      await sql`INSERT INTO app.conversation_api_bindings (org_id, conversation_id, source_deleted)
      VALUES (${scope.organizationId}, 'conversation', true)`;
      await sql`INSERT INTO app.conversation_messages (org_id, conversation_id, channel, direction, delivery_state, metadata)
      VALUES (${scope.organizationId}, 'conversation', 'api', 'outbound', ${deliveryState},
        jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('storageId', ${ref}::text))))`;
      await sql`INSERT INTO app.conversation_messages (org_id, conversation_id, channel, direction, delivery_state, metadata)
      VALUES (${scope.organizationId}, 'conversation', 'api', 'inbound', 'delivered',
        jsonb_build_object('receiptId', 'source-receipt', 'attachments',
          jsonb_build_array(jsonb_build_object('storageId', ${ref}::text))))`;
      const removed = await sql`DELETE FROM app.conversation_messages
      WHERE org_id = ${scope.organizationId} AND conversation_id = 'conversation'
        AND metadata->>'receiptId' = 'source-receipt'
      RETURNING direction`;
      expect(removed).toEqual([{ direction: 'inbound' }]);
      const verdict = async () => {
        const [row] = await sql<{ listed: boolean; held: boolean }[]>`
        SELECT ${listedBlobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS listed,
          ${blobRefHeld(sql, scope.organizationId, sql`${ref}`)} AS held`;
        return row;
      };
      expect(await verdict()).toEqual({ listed: true, held: true });
      const acknowledged =
        await sql`UPDATE app.conversation_messages SET delivery_state = 'delivered'
      WHERE org_id = ${scope.organizationId} AND conversation_id = 'conversation'
        AND direction = 'outbound' AND delivery_state IN ('queued', 'failed')
      RETURNING delivery_state`;
      expect(acknowledged).toEqual([{ delivery_state: 'delivered' }]);
      expect(await verdict()).toEqual({ listed: false, held: false });
    },
  );

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
