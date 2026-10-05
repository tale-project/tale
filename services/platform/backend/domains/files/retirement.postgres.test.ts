import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { runBootMigrations } from '../../db/migrate.ts';
import { createSql } from '../../db/sql.ts';
import { createBoss, ensureQueues } from '../../jobs/boss.ts';
import { setEnqueueBoss } from '../../jobs/enqueue.ts';
import {
  resolveObjectStore,
  s3HeadObject,
  s3PutObject,
} from '../../lib/object-store.ts';
import { appendMessageRow } from '../chat/store.ts';
import {
  acknowledgeApiDelivery,
  claimApiDeliveries,
  synchronizeConversation,
} from '../conversations/api-sync.ts';
import {
  discardOutboundMessage,
  runSendMessageJob,
  undoSendMessage,
  recoverStuckConversationSends,
  retrySendMessage,
} from '../conversations/send.ts';
import { deleteConversation } from '../conversations/service.ts';
import { purgeDocument, purgeThreadLineage } from '../retention/service.ts';
import { replayableChatParts } from './chat-replay.ts';
import { checkBlobRetirementSchema } from './retirement.integration.ts';
import {
  queueBlobRetirement,
  handoffComposerBlobs,
  recoverBlobRetirements,
  retireBlobBatch,
} from './retirement.ts';
import { deleteFile } from './service.ts';
import { ownsUploadedBlob } from './upload-intents.ts';

const fixture = vi.hoisted(() => ({
  failDeletes: false,
  failHints: false,
  failEnqueue: false,
  connector: vi.fn(),
  sentId: '<synthetic@invalid>',
}));
vi.mock('../../lib/org-config.ts', async (original) => ({
  ...(await original<typeof import('../../lib/org-config.ts')>()),
  resolveOrgSlug: vi.fn(async () => 'synthetic'),
}));
vi.mock('../../core/object_storage/file_utils.ts', async (original) => ({
  ...(await original<
    typeof import('../../core/object_storage/file_utils.ts')
  >()),
  readOrgObjectStorageConnection: vi.fn(async () => ({
    connection: {
      region: 'us-east-1',
      endpoint: process.env.ITEST_RETIREMENT_S3_ENDPOINT,
      forcePathStyle: true,
      bucket: 'tale549-synthetic-retirement',
    },
    secrets: { accessKeyId: 'synthetic', secretAccessKey: 'synthetic' },
  })),
}));
vi.mock('../../lib/object-store.ts', async (original) => {
  const actual = await original<typeof import('../../lib/object-store.ts')>();
  return {
    ...actual,
    deleteOrgObject: vi.fn(async (slug: string, key: string) => {
      if (fixture.failDeletes) throw new Error('synthetic storage refusal');
      return actual.deleteOrgObject(slug, key);
    }),
  };
});
vi.mock('../connectors/service.ts', async (original) => ({
  ...(await original<typeof import('../connectors/service.ts')>()),
  runConnectorAction: fixture.connector,
}));
vi.mock('../../core/legacy/knowledge_delete.ts', async (original) => ({
  ...(await original<typeof import('../../core/legacy/knowledge_delete.ts')>()),
  deleteKnowledgeDocumentsBatch: vi.fn(async () => undefined),
}));
vi.mock('../../jobs/enqueue.ts', async (original) => {
  const actual = await original<typeof import('../../jobs/enqueue.ts')>();
  return {
    ...actual,
    addJobInTx: vi.fn(async (...args: Parameters<typeof actual.addJobInTx>) => {
      if (fixture.failEnqueue && args[1] === 'files.retire_blobs')
        throw new Error('synthetic enqueue refusal');
      return actual.addJobInTx(...args);
    }),
  };
});
vi.mock('../../realtime/outbox.ts', async (original) => {
  const actual = await original<typeof import('../../realtime/outbox.ts')>();
  return {
    ...actual,
    emitHintInTx: vi.fn(
      async (...args: Parameters<typeof actual.emitHintInTx>) => {
        if (fixture.failHints)
          throw new Error('synthetic notification refusal');
        return actual.emitHintInTx(...args);
      },
    ),
  };
});

const databaseUrl = process.env.ITEST_RETIREMENT_DATABASE_URL;
const endpoint = process.env.ITEST_RETIREMENT_S3_ENDPOINT;
const org = `synthetic-org-${randomUUID()}`;
const user = 'synthetic-user';

describe.runIf(databaseUrl && endpoint)(
  'private PostgreSQL and synthetic S3 blob retirement',
  () => {
    let sql: Sql;
    let boss: ReturnType<typeof createBoss>;
    let serial = 0;
    const prefix = randomUUID();
    const next = () => `fixture-${prefix}-${++serial}`;
    const present = async (ref: string) =>
      (await s3HeadObject(
        await resolveObjectStore('synthetic'),
        ref.slice(3),
      )) !== null;
    const file = async (documentId: string | null = null) => {
      const id = next();
      const ref = `s3:blobs/synthetic/${id}`;
      await s3PutObject(
        await resolveObjectStore('synthetic'),
        ref.slice(3),
        new TextEncoder().encode(id),
        'text/plain',
      );
      await sql`INSERT INTO app.file_metadata (id, org_id, storage_ref, document_id, uploaded_by,
      file_name, content_type, size, created_at_ms)
      VALUES (${id}, ${org}, ${ref}, ${documentId}, ${user}, 'fixture.txt', 'text/plain', 10, ${Date.now()})`;
      return { id, ref };
    };
    const mail = async (ref: string, state = 'queued') => {
      const conversation = next();
      const message = next();
      await sql`INSERT INTO app.conversations (id, org_id, channel, created_at_ms)
      VALUES (${conversation}, ${org}, 'email', ${Date.now()})`;
      await sql`INSERT INTO app.conversation_messages
      (id, org_id, conversation_id, channel, direction, delivery_state, content, metadata, created_at_ms, attachment_owner_user_id)
      VALUES (${message}, ${org}, ${conversation}, 'email', 'outbound', ${state}, 'fixture',
        ${sql.json({ attachments: [{ storageId: ref, filename: 'fixture.txt', contentType: 'text/plain', size: 10 }] })}, ${Date.now()}, ${user})`;
      return { conversation, message };
    };
    const newThread = async (owner = user) => {
      const thread = next();
      await sql`INSERT INTO app.threads (id, org_id, user_id, created_at_ms, updated_at_ms)
      VALUES (${thread}, ${org}, ${owner}, ${Date.now()}, ${Date.now()})`;
      await sql`INSERT INTO app.thread_metadata (thread_id, org_id, user_id, chat_type, status, created_at_ms)
      VALUES (${thread}, ${org}, ${owner}, 'chat', 'active', ${Date.now()})`;
      return thread;
    };
    const chat = async (ref: string, owner = user) => {
      const thread = await newThread(owner);
      const parts = [
        { type: 'attachment', fileId: ref, mimeType: 'text/plain' },
      ];
      await appendMessageRow(sql, {
        organizationId: org,
        threadId: thread,
        role: 'user',
        parts,
      });
      return thread;
    };

    beforeAll(async () => {
      if (!databaseUrl || !endpoint)
        throw new Error('Missing private lane settings');
      const db = new URL(databaseUrl);
      const store = new URL(endpoint);
      if (
        !['localhost', '127.0.0.1'].includes(db.hostname) ||
        !db.pathname.startsWith('/itest_blob_retirement_') ||
        db.search ||
        !['localhost', '127.0.0.1'].includes(store.hostname) ||
        store.protocol !== 'http:'
      )
        throw new Error('Unsafe synthetic lane target');
      await Promise.all([
        runBootMigrations({ databaseUrl }),
        runBootMigrations({ databaseUrl }),
      ]);
      sql = createSql(databaseUrl);
      await sql.unsafe(
        await readFile(
          new URL(
            '../../db/migrations/0150_blob_reclaims.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const bucket = await fetch(`${endpoint}/tale549-synthetic-retirement`, {
        method: 'PUT',
      });
      if (!bucket.ok && bucket.status !== 409)
        throw new Error(`Synthetic bucket: ${bucket.status}`);
      boss = createBoss(databaseUrl, { supervise: false });
      await boss.start();
      await ensureQueues(boss);
      setEnqueueBoss(boss);
    }, 60_000);
    beforeEach(async () => {
      fixture.failDeletes = false;
      fixture.failHints = false;
      fixture.failEnqueue = false;
      fixture.sentId = `<${next()}@invalid>`;
      fixture.connector.mockReset().mockResolvedValue({
        status: 'ok',
        output: { messageId: fixture.sentId },
      });
      await sql`TRUNCATE app.blob_reclaims, app.blob_composer_handoffs`;
      await sql`DELETE FROM app.legal_holds WHERE org_id = ${org}`;
    });
    afterAll(async () => {
      await boss?.stop();
      await sql?.end();
    });

    it('keeps a file deleted during the undo window until successful send settlement', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      expect(await present(uploaded.ref)).toBe(true);
      await runSendMessageJob(sql, {
        organizationId: org,
        messageId: holder.message,
        connectorName: 'imap-smtp',
        to: ['synthetic@invalid'],
        subject: 'fixture',
        body: 'fixture',
      });
      expect(
        (
          await sql`SELECT delivery_state FROM app.conversation_messages WHERE id = ${holder.message}`
        )[0]?.delivery_state,
      ).toBe('sent');
      await retireBlobBatch(sql, org);
      expect(await present(uploaded.ref)).toBe(false);
    });

    it('does not resurrect a sent holder after a notification failure', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      fixture.failHints = true;
      await runSendMessageJob(sql, {
        organizationId: org,
        messageId: holder.message,
        connectorName: 'imap-smtp',
        to: ['synthetic@invalid'],
        subject: 'fixture',
        body: 'fixture',
      });
      await retireBlobBatch(sql, org);
      expect(
        (
          await sql`SELECT delivery_state FROM app.conversation_messages WHERE id = ${holder.message}`
        )[0]?.delivery_state,
      ).toBe('sent');
      expect(await present(uploaded.ref)).toBe(false);
    });

    it('recovers observed delivery after transactional reclaim enqueue failed without resending', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      fixture.failEnqueue = true;
      await expect(
        runSendMessageJob(sql, {
          organizationId: org,
          messageId: holder.message,
          connectorName: 'imap-smtp',
          to: ['synthetic@invalid'],
          subject: 'fixture',
          body: 'fixture',
        }),
      ).rejects.toThrow('synthetic enqueue refusal');
      const pending =
        await sql`SELECT delivery_state, metadata FROM app.conversation_messages WHERE id = ${holder.message}`;
      expect(pending[0]?.delivery_state).toBe('queued');
      expect(pending[0]?.metadata.sendDeliveredAt).toEqual(expect.any(Number));
      expect(await present(uploaded.ref)).toBe(true);
      fixture.failEnqueue = false;
      await recoverStuckConversationSends(sql);
      await retireBlobBatch(sql, org);
      expect(fixture.connector).toHaveBeenCalledTimes(1);
      expect(
        (
          await sql`SELECT delivery_state FROM app.conversation_messages WHERE id = ${holder.message}`
        )[0]?.delivery_state,
      ).toBe('sent');
      expect(await present(uploaded.ref)).toBe(false);
    });

    it('a stale failing connector attempt cannot resurrect a newer successful send', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql`UPDATE app.conversation_messages SET connector_name = 'imap-smtp',
        metadata = metadata || ${sql.json({ to: ['synthetic@invalid'], subject: 'fixture' })}
        WHERE id = ${holder.message}`;
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      const entered = Promise.withResolvers<void>();
      const provider = Promise.withResolvers<unknown>();
      fixture.connector.mockImplementationOnce(() => {
        entered.resolve();
        return provider.promise;
      });
      const payload = {
        organizationId: org,
        messageId: holder.message,
        connectorName: 'imap-smtp',
        to: ['synthetic@invalid'],
        subject: 'fixture',
        body: 'fixture',
      };
      const oldAttempt = runSendMessageJob(sql, payload);
      await entered.promise;
      await sql`UPDATE app.conversation_messages SET status_changed_at_ms = 0 WHERE id = ${holder.message}`;
      await recoverStuckConversationSends(sql, { staleMs: 1 });
      await retrySendMessage(sql, {
        organizationId: org,
        messageId: holder.message,
        actor: { userId: user },
      });
      await runSendMessageJob(sql, payload);
      await retireBlobBatch(sql, org);
      provider.reject(new Error('synthetic old attempt failure'));
      await oldAttempt;
      expect(
        (
          await sql`SELECT delivery_state FROM app.conversation_messages WHERE id = ${holder.message}`
        )[0]?.delivery_state,
      ).toBe('sent');
      expect(await present(uploaded.ref)).toBe(false);
    });

    it('refuses an attachment whose metadata deletion wins the append race', async () => {
      const uploaded = await file();
      const thread = await newThread();
      const deleted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const deletion = sql.begin(async (tx) => {
        await deleteFile(sql, tx, { organizationId: org }, uploaded.id);
        deleted.resolve();
        await release.promise;
      });
      await deleted.promise;
      const appended = appendMessageRow(sql, {
        organizationId: org,
        threadId: thread,
        role: 'user',
        parts: [{ type: 'attachment', fileId: uploaded.ref }],
      });
      const refused = expect(appended).rejects.toMatchObject({
        code: 'ATTACHMENT_UNAVAILABLE',
      });
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const active = await sql`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%locked_attachment_files%'`;
          blocked = active.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
      } finally {
        release.resolve();
        await deletion;
      }
      await refused;
      expect(
        await sql`SELECT id FROM app.messages WHERE thread_id = ${thread}`,
      ).toHaveLength(0);
    });

    it('keeps a committed owned attachment when its append wins metadata deletion', async () => {
      const uploaded = await file();
      const thread = await newThread();
      const appended = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const insertion = sql.begin(async (tx) => {
        await appendMessageRow(tx, {
          organizationId: org,
          threadId: thread,
          role: 'user',
          parts: [{ type: 'attachment', fileId: uploaded.ref }],
        });
        appended.resolve();
        await release.promise;
      });
      await appended.promise;
      const deletion = sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      try {
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const active = await sql`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%app.file_metadata%' AND query LIKE '%FOR UPDATE%'`;
          blocked = active.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
      } finally {
        release.resolve();
        await insertion;
      }
      await deletion;
      expect(await present(uploaded.ref)).toBe(true);
      const replay =
        await sql`SELECT ${replayableChatParts(sql, org, sql`message`)} AS parts
        FROM app.messages message WHERE thread_id = ${thread}`;
      expect(replay[0]?.parts[0]?.type).toBe('attachment');
    });

    it('runs the native integration schema and transactional rollback probe', async () => {
      const checks: boolean[] = [];
      await checkBlobRetirementSchema(sql, (_name, passed) => {
        checks.push(passed);
      });
      expect(checks).toEqual([true, true, true]);
    });

    it('undo gives only the actor a bounded handoff with reclamation after expiry', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      await undoSendMessage(sql, {
        organizationId: org,
        messageId: holder.message,
        actor: { userId: user },
      });
      expect(
        await ownsUploadedBlob(sql, {
          organizationId: org,
          userId: user,
          storageRef: uploaded.ref,
        }),
      ).toBe(true);
      expect(
        await ownsUploadedBlob(sql, {
          organizationId: org,
          userId: 'other',
          storageRef: uploaded.ref,
        }),
      ).toBe(false);
      expect(await present(uploaded.ref)).toBe(true);
      await sql`UPDATE app.blob_composer_handoffs SET expires_at_ms = 0`;
      await sql`UPDATE app.blob_reclaims SET next_attempt_at_ms = 0`;
      await retireBlobBatch(sql, org);
      expect(await present(uploaded.ref)).toBe(false);
    });

    it.each(['discard', 'conversation'])(
      'reclaims orphan bytes after %s removes a failed holder',
      async (ending) => {
        const uploaded = await file();
        const holder = await mail(uploaded.ref, 'failed');
        await sql.begin((tx) =>
          deleteFile(sql, tx, { organizationId: org }, uploaded.id),
        );
        if (ending === 'discard')
          await discardOutboundMessage(sql, {
            organizationId: org,
            messageId: holder.message,
            actor: { userId: user },
          });
        else await deleteConversation(sql, org, holder.conversation);
        await retireBlobBatch(sql, org);
        expect(await present(uploaded.ref)).toBe(false);
      },
    );

    it('persists owned chat provenance after file deletion and reclaims on purge', async () => {
      const uploaded = await file();
      const thread = await chat(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      expect(await present(uploaded.ref)).toBe(true);
      await purgeThreadLineage(sql, org, thread);
      await retireBlobBatch(sql, org);
      expect(await present(uploaded.ref)).toBe(false);
    });

    it('borrowed document attachments cannot veto destruction or replay the destroyed ref', async () => {
      const document = next();
      const uploaded = await file(document);
      await sql`INSERT INTO app.documents (id, org_id, title, file_ref, created_at_ms, updated_at_ms)
      VALUES (${document}, ${org}, 'fixture', ${uploaded.ref}, ${Date.now()}, ${Date.now()})`;
      const thread = await chat(uploaded.ref, 'reader');
      const outcome = await purgeDocument(sql, 'synthetic', {
        id: document,
        organizationId: org,
        fileRef: uploaded.ref,
      });
      expect(outcome).toEqual({
        bytesRetained: 0,
        bytesDeleted: 1,
        bytesUnknown: 0,
      });
      expect(await present(uploaded.ref)).toBe(false);
      const replay =
        await sql`SELECT ${replayableChatParts(sql, org, sql`message`)} AS parts
      FROM app.messages message WHERE thread_id = ${thread}`;
      expect(replay[0]?.parts).toEqual([
        { type: 'text', text: '[attachment unavailable]' },
      ]);
    });

    it('rolls back candidate enqueue and retries observed storage failures', async () => {
      const uploaded = await file();
      await sql`DELETE FROM app.file_metadata WHERE id = ${uploaded.id}`;
      await expect(
        sql.begin(async (tx) => {
          await queueBlobRetirement(tx, org, [uploaded.ref]);
          throw new Error('synthetic rollback');
        }),
      ).rejects.toThrow('synthetic rollback');
      expect(await sql`SELECT storage_ref FROM app.blob_reclaims`).toHaveLength(
        0,
      );
      await sql.begin((tx) => queueBlobRetirement(tx, org, [uploaded.ref]));
      fixture.failDeletes = true;
      await expect(retireBlobBatch(sql, org)).rejects.toThrow(
        'durable candidates retained',
      );
      expect(await present(uploaded.ref)).toBe(true);
      expect(
        (await sql`SELECT last_outcome FROM app.blob_reclaims`)[0]
          ?.last_outcome,
      ).toBe('failed');
      fixture.failDeletes = false;
      await sql`UPDATE app.blob_reclaims SET next_attempt_at_ms = 0`;
      await recoverBlobRetirements(sql);
      await retireBlobBatch(sql, org);
      expect(await present(uploaded.ref)).toBe(false);
      expect(await sql`SELECT storage_ref FROM app.blob_reclaims`).toHaveLength(
        0,
      );
    });

    it.each(['acknowledgement', 'source removal', 'source teardown'])(
      'retires API attachments at actual holder end: %s',
      async (ending) => {
        const uploaded = await file();
        const holder = await mail(uploaded.ref);
        const external = next();
        await sql`UPDATE app.conversation_messages SET channel = 'api' WHERE id = ${holder.message}`;
        await sql`INSERT INTO app.conversation_api_bindings
      (conversation_id, org_id, source, external_id, external_contact_id, owner_user_id, snapshot_version)
      VALUES (${holder.conversation}, ${org}, 'synthetic', ${external}, 'synthetic-contact', ${user}, 1)`;
        const viewer = {
          organizationId: org,
          userId: user,
          role: 'admin',
          teamIds: [],
        };
        await sql.begin((tx) =>
          deleteFile(sql, tx, { organizationId: org }, uploaded.id),
        );
        expect(await present(uploaded.ref)).toBe(true);
        if (ending === 'acknowledgement') {
          await sql`INSERT INTO app.conversation_api_deliveries
        (message_id, conversation_id, org_id, actor_user_id, actor_email, body, available_at_ms, retry_at_ms, claimed_at_ms)
        VALUES (${holder.message}, ${holder.conversation}, ${org}, ${user}, 'synthetic@invalid', 'fixture', 0, 0, 1)`;
          await acknowledgeApiDelivery(sql, viewer, holder.message, next(), 2);
        } else {
          if (ending === 'source removal')
            await sql`INSERT INTO app.conversation_api_messages (conversation_id, external_id, message_id, source_version)
        VALUES (${holder.conversation}, ${next()}, ${holder.message}, 1)`;
          else
            await sql`INSERT INTO app.conversation_api_deliveries
          (message_id, conversation_id, org_id, actor_user_id, actor_email, body, available_at_ms, retry_at_ms)
          VALUES (${holder.message}, ${holder.conversation}, ${org}, ${user}, 'synthetic@invalid', 'fixture', 0, 0)`;
          await synchronizeConversation(sql, viewer, {
            source: 'synthetic',
            externalId: external,
            externalContactId: 'synthetic-contact',
            version: 2,
            subject: 'fixture',
            status: 'open',
            deleted: ending === 'source teardown',
            messages: [],
            replyConstraints: {
              minBodyChars: 0,
              maxBodyChars: 1000,
              maxAttachments: 10,
              maxAttachmentBytes: 1000,
            },
          });
          if (ending === 'source teardown') {
            expect(
              await sql`SELECT id FROM app.conversation_messages WHERE id = ${holder.message}`,
            ).toHaveLength(1);
            await retireBlobBatch(sql, org);
            expect(await present(uploaded.ref)).toBe(true);
            const claims = await claimApiDeliveries(
              sql,
              viewer,
              'synthetic',
              25,
            );
            expect(
              claims.some((claim) => claim.messageId === holder.message),
            ).toBe(true);
            await acknowledgeApiDelivery(
              sql,
              viewer,
              holder.message,
              next(),
              2,
            );
          }
        }
        await retireBlobBatch(sql, org);
        expect(await present(uploaded.ref)).toBe(false);
      },
    );

    it('another undo actor cannot acquire the send authors upload ownership', async () => {
      const uploaded = await file();
      const holder = await mail(uploaded.ref);
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      const result = await undoSendMessage(sql, {
        organizationId: org,
        messageId: holder.message,
        actor: { userId: 'other' },
      });
      expect(result.attachments).toEqual([]);
      expect(
        await ownsUploadedBlob(sql, {
          organizationId: org,
          userId: 'other',
          storageRef: uploaded.ref,
        }),
      ).toBe(false);
      expect(
        await ownsUploadedBlob(sql, {
          organizationId: org,
          userId: user,
          storageRef: uploaded.ref,
        }),
      ).toBe(true);
    });

    it('retention preserves a real independent twin but blocks borrowed replay', async () => {
      const document = next();
      const uploaded = await file(document);
      await sql`INSERT INTO app.documents (id, org_id, title, file_ref, created_at_ms, updated_at_ms)
      VALUES (${document}, ${org}, 'fixture', ${uploaded.ref}, ${Date.now()}, ${Date.now()})`;
      const thread = await chat(uploaded.ref, 'reader');
      await sql`INSERT INTO app.file_metadata (org_id, storage_ref, uploaded_by, file_name, content_type, size, created_at_ms)
      VALUES (${org}, ${uploaded.ref}, 'independent-owner', 'twin.txt', 'text/plain', 10, ${Date.now()})`;
      expect(
        await purgeDocument(sql, 'synthetic', {
          id: document,
          organizationId: org,
          fileRef: uploaded.ref,
        }),
      ).toEqual({ bytesRetained: 1, bytesDeleted: 0, bytesUnknown: 0 });
      expect(await present(uploaded.ref)).toBe(true);
      const replay =
        await sql`SELECT ${replayableChatParts(sql, org, sql`message`)} AS parts
      FROM app.messages message WHERE thread_id = ${thread}`;
      expect(replay[0]?.parts).toEqual([
        { type: 'text', text: '[attachment unavailable]' },
      ]);
    });

    it('counts legacy bytes as unverifiable rather than deleted', async () => {
      const document = next();
      await sql`INSERT INTO app.documents (id, org_id, title, file_ref, created_at_ms, updated_at_ms)
      VALUES (${document}, ${org}, 'fixture', 'legacy-unaddressable', ${Date.now()}, ${Date.now()})`;
      expect(
        await purgeDocument(sql, 'synthetic', {
          id: document,
          organizationId: org,
          fileRef: 'legacy-unaddressable',
        }),
      ).toEqual({ bytesRetained: 0, bytesDeleted: 0, bytesUnknown: 1 });
    });

    it('allows borrowed non-document replay only while its original binding remains', async () => {
      const uploaded = await file();
      const thread = await chat(uploaded.ref, 'reader');
      const before =
        await sql`SELECT ${replayableChatParts(sql, org, sql`message`)} AS parts
      FROM app.messages message WHERE thread_id = ${thread}`;
      expect(before[0]?.parts[0]?.type).toBe('attachment');
      await sql.begin((tx) =>
        deleteFile(sql, tx, { organizationId: org }, uploaded.id),
      );
      expect(await present(uploaded.ref)).toBe(false);
      const after =
        await sql`SELECT ${replayableChatParts(sql, org, sql`message`)} AS parts
      FROM app.messages message WHERE thread_id = ${thread}`;
      expect(after[0]?.parts).toEqual([
        { type: 'text', text: '[attachment unavailable]' },
      ]);
    });

    it('bounds recovery dispatch and rotates its backlog without requiring successful deletes', async () => {
      const refs = Array.from(
        { length: 51 },
        () => `s3:blobs/synthetic/${next()}`,
      );
      await sql`INSERT INTO app.blob_reclaims (org_id, storage_ref, next_attempt_at_ms, created_at_ms)
      SELECT ${org}, ref, 0, 0 FROM unnest(${refs}::text[]) refs(ref)`;
      for (const expected of [25, 50, 51]) {
        await recoverBlobRetirements(sql);
        const count =
          await sql`SELECT count(*)::int AS dispatched FROM app.blob_reclaims
        WHERE org_id = ${org} AND next_dispatch_at_ms > 0`;
        expect(count[0]?.dispatched).toBe(expected);
      }
    });

    it('does not record document destruction when S3 refuses deletion', async () => {
      const document = next();
      const uploaded = await file(document);
      await sql`INSERT INTO app.documents (id, org_id, title, file_ref, created_at_ms, updated_at_ms)
      VALUES (${document}, ${org}, 'fixture', ${uploaded.ref}, ${Date.now()}, ${Date.now()})`;
      fixture.failDeletes = true;
      await expect(
        purgeDocument(sql, 'synthetic', {
          id: document,
          organizationId: org,
          fileRef: uploaded.ref,
        }),
      ).rejects.toThrow();
      expect(
        await sql`SELECT id FROM app.documents WHERE id = ${document}`,
      ).toHaveLength(1);
      expect(await present(uploaded.ref)).toBe(true);
    });

    it('preserves restorable rows and legal custodians without pinning another authors refs', async () => {
      const restorable = await file();
      await sql`UPDATE app.file_metadata SET lifecycle_status = 'trashed' WHERE id = ${restorable.id}`;
      await sql.begin((tx) =>
        queueBlobRetirement(tx, org, [restorable.ref], 0, [user]),
      );
      await retireBlobBatch(sql, org);
      expect(await present(restorable.ref)).toBe(true);
      const held = await file();
      const free = await file();
      await sql`DELETE FROM app.file_metadata WHERE id = ANY(${[held.id, free.id]}::text[])`;
      await sql`INSERT INTO app.legal_holds (org_id, target_type, target_id, target_label, reason, placed_by, placed_at_ms)
      VALUES (${org}, 'userMembership', ${user}, 'synthetic', 'proof', 'synthetic', 0)`;
      await sql.begin(async (tx) => {
        await queueBlobRetirement(tx, org, [held.ref], 0, [user]);
        await queueBlobRetirement(tx, org, [free.ref], 0, ['other']);
      });
      await retireBlobBatch(sql, org);
      expect(await present(held.ref)).toBe(true);
      expect(await present(free.ref)).toBe(false);
    });

    it('preserves per-ref authors when a conversation retires a mixed-author batch', async () => {
      const held = await file();
      const free = await file();
      const first = await mail(held.ref, 'failed');
      const second = await mail(free.ref, 'failed');
      await sql`UPDATE app.conversation_messages SET attachment_owner_user_id = 'held-author' WHERE id = ${first.message}`;
      await sql`UPDATE app.conversation_messages SET attachment_owner_user_id = 'free-author', conversation_id = ${first.conversation} WHERE id = ${second.message}`;
      await sql.begin(async (tx) => {
        await deleteFile(sql, tx, { organizationId: org }, held.id);
        await deleteFile(sql, tx, { organizationId: org }, free.id);
      });
      await sql`INSERT INTO app.legal_holds (org_id, target_type, target_id, target_label, reason, placed_by, placed_at_ms)
        VALUES (${org}, 'userMembership', 'held-author', 'synthetic', 'proof', 'synthetic', 0)`;
      await deleteConversation(sql, org, first.conversation);
      const rows =
        await sql`SELECT storage_ref, custodian_user_ids FROM app.blob_reclaims ORDER BY storage_ref`;
      expect(
        rows.find((row) => row.storage_ref === held.ref)?.custodian_user_ids,
      ).toEqual(['held-author']);
      expect(
        rows.find((row) => row.storage_ref === free.ref)?.custodian_user_ids,
      ).toEqual(['free-author']);
      await retireBlobBatch(sql, org);
      expect(await present(held.ref)).toBe(true);
      expect(await present(free.ref)).toBe(false);
    });

    it('renewal waits on the retirement ledger without holding the expiring handoff lock', async () => {
      const ref = `s3:blobs/synthetic/${next()}`;
      await sql.begin((tx) => queueBlobRetirement(tx, org, [ref], 0, [user]));
      await sql`INSERT INTO app.blob_composer_handoffs (org_id, user_id, storage_ref, expires_at_ms)
        VALUES (${org}, ${user}, ${ref}, 0)`;
      let renewal: Promise<void> = Promise.resolve();
      await sql.begin(async (tx) => {
        await tx`SELECT storage_ref FROM app.blob_reclaims WHERE org_id = ${org} AND storage_ref = ${ref} FOR UPDATE`;
        renewal = sql.begin((handoff) =>
          handoffComposerBlobs(handoff, org, user, [ref]),
        );
        let blocked = false;
        for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
          const active = await sql`SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%INSERT INTO app.blob_reclaims%'`;
          blocked = active.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        await tx`DELETE FROM app.blob_composer_handoffs WHERE org_id = ${org} AND storage_ref = ${ref} AND expires_at_ms = 0`;
      });
      await renewal;
      const rows =
        await sql`SELECT expires_at_ms FROM app.blob_composer_handoffs WHERE org_id = ${org} AND storage_ref = ${ref}`;
      expect(Number(rows[0]?.expires_at_ms)).toBeGreaterThan(Date.now());
    });
  },
);
