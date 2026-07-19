// Send-then-wait: readiness matrix + watcher lifecycle + deferred-bind
// helpers. The turn START itself (startMediaTurn) goes through the
// persistent-streaming component, which convex-test cannot register — that
// path mirrors startQueuedTurn line-for-line and is covered by typecheck +
// review (see threads/media_send.ts docblock).

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  bindJobsForDeferredSend,
  buildBoundJobAttachments,
  unbindDeferredJobs,
} from '../video_links/bind_for_send';
import { isMediaSendReady } from './media_send';

const TEST_DIR_FROM_CONVEX_ROOT = 'threads';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

const ORG = 'org_media_send';
const THREAD = 'thread_media_1';
const USER = 'user_sender';

async function seedVideoJob(
  t: T,
  overrides: {
    status?:
      | 'queued'
      | 'fetching_captions'
      | 'transcribing_handoff'
      | 'completed'
      | 'failed'
      | 'skipped';
    withMeta?: 'completed' | 'running';
    threadId?: string | undefined;
    uploadedBy?: string;
    messageBoundAt?: number;
  } = {},
): Promise<Id<'videoLinkJobs'>> {
  return t.run(async (ctx) => {
    let fileMetadataId: Id<'fileMetadata'> | undefined;
    if (overrides.withMeta) {
      fileMetadataId = await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: `s3:${ORG}/job-blob-${Math.floor(Math.random() * 1e9)}`,
        source: 'video_link',
        fileName: 'Video.txt',
        contentType: 'text/plain; charset=utf-8',
        size: 42,
        transcript: 'Hello transcript.',
        transcriptionStatus: overrides.withMeta,
      });
    }
    return ctx.db.insert('videoLinkJobs', {
      organizationId: ORG,
      ...(overrides.threadId !== undefined && {
        threadId: overrides.threadId,
      }),
      uploadedBy: overrides.uploadedBy ?? USER,
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      sourceUrlHash: 'hash_media_send',
      sourcePlatform: 'youtube',
      pastedToken: 'https://www.youtube.com/watch?v=abc',
      status: overrides.status ?? 'completed',
      statusChangedAt: Date.now(),
      lifecycleStatus: 'active',
      videoTitle: 'Video',
      ...(overrides.messageBoundAt !== undefined && {
        messageBoundAt: overrides.messageBoundAt,
      }),
      ...(fileMetadataId !== undefined && { fileMetadataId }),
      ...(fileMetadataId !== undefined && {
        storageId: `s3:${ORG}/job-storage`,
      }),
    });
  });
}

async function seedWaitingRow(
  t: T,
  fields: {
    videoJobIds?: Id<'videoLinkJobs'>[];
    attachments?: Array<{
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    }>;
    status?: 'waiting_media' | 'queued';
  } = {},
): Promise<Id<'chatMessageQueue'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('chatMessageQueue', {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      userEmail: 'sender@example.com',
      userName: 'Sender',
      agentSlug: 'assistant',
      messageId: 'row-1',
      deferredPersist: true,
      text: 'Summarize this video',
      status: fields.status ?? 'waiting_media',
      createdAt: Date.now(),
      waitingSince: Date.now(),
      ...(fields.videoJobIds !== undefined && {
        videoJobIds: fields.videoJobIds,
      }),
      ...(fields.attachments !== undefined && {
        attachments: fields.attachments,
      }),
    }),
  );
}

async function seedDocMeta(
  t: T,
  storageId: string,
  ragStatus: 'queued' | 'running' | 'completed' | 'failed' | undefined,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 1000,
      ...(ragStatus !== undefined && { ragStatus }),
    });
  });
}

function readiness(t: T, rowId: Id<'chatMessageQueue'>): Promise<boolean> {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(rowId);
    if (!row) throw new Error('row missing');
    return isMediaSendReady(ctx, row);
  });
}

describe('isMediaSendReady', () => {
  it('is ready when every video job completed', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedVideoJob(t, { status: 'completed' });
    const rowId = await seedWaitingRow(t, { videoJobIds: [jobId] });
    expect(await readiness(t, rowId)).toBe(true);
  });

  it('waits on an in-flight video job', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedVideoJob(t, { status: 'fetching_captions' });
    const rowId = await seedWaitingRow(t, { videoJobIds: [jobId] });
    expect(await readiness(t, rowId)).toBe(false);
  });

  it('holds on a failed video job (user action required)', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedVideoJob(t, { status: 'failed' });
    const rowId = await seedWaitingRow(t, { videoJobIds: [jobId] });
    expect(await readiness(t, rowId)).toBe(false);
  });

  it('excludes cancelled jobs and erased jobs', async () => {
    const t = convexTest(schema, modules);
    const skippedId = await seedVideoJob(t, { status: 'skipped' });
    const erasedId = await seedVideoJob(t, { status: 'completed' });
    await t.run(async (ctx) => ctx.db.delete(erasedId));
    const rowId = await seedWaitingRow(t, {
      videoJobIds: [skippedId, erasedId],
    });
    expect(await readiness(t, rowId)).toBe(true);
  });

  it('treats Whisper handoff with a completed transcript as ready', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedVideoJob(t, {
      status: 'transcribing_handoff',
      withMeta: 'completed',
    });
    const rowId = await seedWaitingRow(t, { videoJobIds: [jobId] });
    expect(await readiness(t, rowId)).toBe(true);
  });

  it('waits on a doc attachment while RAG indexing is active, proceeds on terminal', async () => {
    const t = convexTest(schema, modules);
    const doc = {
      fileId: `s3:${ORG}/doc-1`,
      fileName: 'report.pdf',
      fileType: 'application/pdf',
      fileSize: 1000,
    };
    await seedDocMeta(t, doc.fileId, 'running');
    const rowId = await seedWaitingRow(t, { attachments: [doc] });
    expect(await readiness(t, rowId)).toBe(false);

    const t2 = convexTest(schema, modules);
    await seedDocMeta(t2, doc.fileId, 'failed');
    const rowId2 = await seedWaitingRow(t2, { attachments: [doc] });
    expect(await readiness(t2, rowId2)).toBe(true);
  });

  it('never gates on images or unknown files', async () => {
    const t = convexTest(schema, modules);
    const rowId = await seedWaitingRow(t, {
      attachments: [
        {
          fileId: `s3:${ORG}/img-1`,
          fileName: 'pic.png',
          fileType: 'image/png',
          fileSize: 10,
        },
        {
          fileId: `s3:${ORG}/no-meta`,
          fileName: 'stray.bin',
          fileType: 'application/octet-stream',
          fileSize: 10,
        },
      ],
    });
    expect(await readiness(t, rowId)).toBe(true);
  });
});

describe('checkMediaSendReadiness (non-start paths)', () => {
  it('reschedules (row intact) while media is pending', async () => {
    const t = convexTest(schema, modules);
    const jobId = await seedVideoJob(t, { status: 'fetching_captions' });
    const rowId = await seedWaitingRow(t, { videoJobIds: [jobId] });
    await t.run(async (ctx) => {
      await ctx.db.insert('threadMetadata', {
        threadId: THREAD,
        userId: USER,
        chatType: 'general',
        status: 'active',
        createdAt: Date.now(),
        organizationId: ORG,
      });
    });

    await t.mutation(internal.threads.media_send.checkMediaSendReadiness, {
      queueId: rowId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.status).toBe('waiting_media');
  });

  it('drops an orphaned row when the thread is gone', async () => {
    const t = convexTest(schema, modules);
    const rowId = await seedWaitingRow(t);

    await t.mutation(internal.threads.media_send.checkMediaSendReadiness, {
      queueId: rowId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row).toBeNull();
  });

  it('no-ops on a row that already left waiting_media', async () => {
    const t = convexTest(schema, modules);
    const rowId = await seedWaitingRow(t, { status: 'queued' });

    await t.mutation(internal.threads.media_send.checkMediaSendReadiness, {
      queueId: rowId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    expect(row?.status).toBe('queued');
  });
});

describe('deferred bind helpers', () => {
  it('claims unbound own jobs, stamping threadId on welcome-page rows', async () => {
    const t = convexTest(schema, modules);
    const preThread = await seedVideoJob(t, {
      status: 'fetching_captions',
      threadId: undefined,
    });
    const foreign = await seedVideoJob(t, { uploadedBy: 'someone_else' });
    const alreadyBound = await seedVideoJob(t, { messageBoundAt: 123 });

    const claimed = await t.run(async (ctx) =>
      bindJobsForDeferredSend(ctx, {
        jobIds: [preThread, foreign, alreadyBound],
        userId: USER,
        threadId: THREAD,
        organizationId: ORG,
      }),
    );

    expect(claimed).toEqual([preThread]);
    const job = await t.run(async (ctx) => ctx.db.get(preThread));
    expect(job?.threadId).toBe(THREAD);
    expect(job?.messageBoundAt).toBeDefined();
  });

  it('unbind releases only the owner rows', async () => {
    const t = convexTest(schema, modules);
    const own = await seedVideoJob(t, { messageBoundAt: 123 });
    const foreign = await seedVideoJob(t, {
      uploadedBy: 'someone_else',
      messageBoundAt: 456,
    });

    await t.run(async (ctx) => unbindDeferredJobs(ctx, [own, foreign], USER));

    const ownRow = await t.run(async (ctx) => ctx.db.get(own));
    const foreignRow = await t.run(async (ctx) => ctx.db.get(foreign));
    expect(ownRow?.messageBoundAt).toBeUndefined();
    expect(foreignRow?.messageBoundAt).toBe(456);
  });

  it('builds payloads only for transcript-ready jobs', async () => {
    const t = convexTest(schema, modules);
    const ready = await seedVideoJob(t, {
      status: 'completed',
      withMeta: 'completed',
    });
    const whisperReady = await seedVideoJob(t, {
      status: 'transcribing_handoff',
      withMeta: 'completed',
    });
    const pending = await seedVideoJob(t, { status: 'fetching_captions' });

    const payloads = await t.run(async (ctx) =>
      buildBoundJobAttachments(ctx, [ready, whisperReady, pending]),
    );

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      fileName: 'Video',
      fileType: 'video/mp4',
      fileSize: 42,
    });
  });
});
