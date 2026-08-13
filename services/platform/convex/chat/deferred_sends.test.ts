/**
 * Send-then-wait: a send parked during attachment processing must wait for
 * exactly the right conditions (the 0.3 readiness matrix), start once — and
 * only once the thread is idle — and die cleanly when cancelled. The tests
 * drive the internal mutations directly instead of the scheduler so the
 * self-rescheduling watcher chain stays deterministic.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import type { TurnStore } from '../../lib/chat/turn';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { settleDeferredSendOnUserAppend } from './turn_store';

const TEST_DIR_FROM_CONVEX_ROOT = 'chat';
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

const ORG = 'org_defer';
const USER = 'user_defer';

async function seedThread(t: T): Promise<string> {
  return await t.run(async (ctx) =>
    String(
      await ctx.db.insert('threads', {
        organizationId: ORG,
        userId: USER,
        kind: 'direct',
        archived: false,
        createdAt: 0,
        updatedAt: 0,
      }),
    ),
  );
}

async function seedRow(
  t: T,
  threadId: string,
  overrides: Record<string, unknown> = {},
): Promise<Id<'deferredSends'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('deferredSends', {
      organizationId: ORG,
      userId: USER,
      threadId,
      userText: 'summarize the attachment',
      modelId: 'test-model',
      locale: 'en',
      status: 'waiting' as const,
      createdAt: 1,
      waitingSince: 1,
      ...overrides,
    }),
  );
}

async function seedFileMeta(
  t: T,
  storageId: string,
  fields: { contentType?: string } & Record<string, unknown>,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId,
      fileName: storageId,
      contentType: fields.contentType ?? 'application/pdf',
      size: 10,
      ...fields,
    });
  });
}

const attachment = (fileId: string, fileType: string) => ({
  fileId,
  fileName: fileId,
  fileType,
  fileSize: 10,
});

describe('deferred sends — readiness matrix', () => {
  async function readiness(t: T, rowId: Id<'deferredSends'>): Promise<boolean> {
    // Run the watcher once and read the row back: still `waiting` means not
    // ready (it rescheduled); `claimed` means it started.
    await t.mutation(internal.chat.deferred_sends.checkDeferredSendReadiness, {
      deferredSendId: rowId,
    });
    const row = await t.run(async (ctx) => ctx.db.get(rowId));
    return row?.status === 'claimed';
  }

  it('waits while a document still indexes, proceeds once terminal — failed included', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await seedFileMeta(t, 'doc_running', { ragStatus: 'running' });
    const waiting = await seedRow(t, threadId, {
      attachments: [attachment('doc_running', 'application/pdf')],
    });
    expect(await readiness(t, waiting)).toBe(false);

    await seedFileMeta(t, 'doc_failed', { ragStatus: 'failed' });
    const degraded = await seedRow(t, threadId, {
      attachments: [attachment('doc_failed', 'application/pdf')],
    });
    expect(await readiness(t, degraded)).toBe(true);
  });

  it('waits on active transcription; failed transcription proceeds degraded', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await seedFileMeta(t, 'clip_running', {
      contentType: 'audio/mpeg',
      transcriptionStatus: 'running',
    });
    const waiting = await seedRow(t, threadId, {
      attachments: [attachment('clip_running', 'audio/mpeg')],
    });
    expect(await readiness(t, waiting)).toBe(false);

    await seedFileMeta(t, 'clip_failed', {
      contentType: 'audio/mpeg',
      transcriptionStatus: 'failed',
    });
    const degraded = await seedRow(t, threadId, {
      attachments: [attachment('clip_failed', 'audio/mpeg')],
    });
    expect(await readiness(t, degraded)).toBe(true);
  });

  it('never gates on images or files without a pipeline record', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await seedFileMeta(t, 'shot', { contentType: 'image/png' });
    const row = await seedRow(t, threadId, {
      attachments: [
        attachment('shot', 'image/png'),
        attachment('ghost', 'application/pdf'),
      ],
    });
    expect(await readiness(t, row)).toBe(true);
  });

  it('waits for a live generation to settle before claiming', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId: ORG,
        threadId,
        status: 'streaming' as const,
        startedAt: 0,
        heartbeatAt: 0,
      });
    });
    const row = await seedRow(t, threadId);
    expect(await readiness(t, row)).toBe(false);
  });

  it('a failed video job holds the send for the user; a cancelled row ends the chain', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert('videoLinkJobs', {
        organizationId: ORG,
        threadId,
        uploadedBy: USER,
        sourceUrl: 'https://youtu.be/x',
        sourceUrlHash: 'h',
        sourcePlatform: 'youtube',
        pastedToken: 'https://youtu.be/x',
        status: 'failed' as const,
        statusChangedAt: 0,
      }),
    );
    const row = await seedRow(t, threadId, { videoJobIds: [jobId] });
    expect(await readiness(t, row)).toBe(false);

    // Cancel deletes the row; the next watcher tick is a silent no-op.
    await t.run(async (ctx) => ctx.db.delete(row));
    await t.mutation(internal.chat.deferred_sends.checkDeferredSendReadiness, {
      deferredSendId: row,
    });
  });
});

describe('deferred sends — claim and settle', () => {
  it('claims a ready row exactly once and settles it after the turn', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const row = await seedRow(t, threadId);

    await t.mutation(internal.chat.deferred_sends.checkDeferredSendReadiness, {
      deferredSendId: row,
    });
    const claimed = await t.run(async (ctx) => ctx.db.get(row));
    expect(claimed?.status).toBe('claimed');

    // The claimed turn runs detached; in this environment it dies at
    // provider resolution — the action must still record a visible
    // assistant error message and delete the row.
    await t.action(async (ctx) =>
      ctx.runAction(internal.chat.turn_action.runDeferredSend, {
        deferredSendId: row,
      }),
    );
    expect(await t.run(async (ctx) => ctx.db.get(row))).toBeNull();
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('messages')
        .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
        .collect(),
    );
    expect(messages.some((message) => message.error !== undefined)).toBe(true);
  });

  it('re-queues instead of dropping when a direct send raced the claim', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const row = await seedRow(t, threadId, { status: 'claimed' as const });
    await t.run(async (ctx) => {
      await ctx.db.insert('generations', {
        organizationId: ORG,
        threadId,
        status: 'streaming' as const,
        startedAt: 0,
        heartbeatAt: 0,
      });
    });

    await t.action(async (ctx) =>
      ctx.runAction(internal.chat.turn_action.runDeferredSend, {
        deferredSendId: row,
      }),
    );

    const requeued = await t.run(async (ctx) => ctx.db.get(row));
    expect(requeued?.status).toBe('waiting');
  });

  it('settles an orphan whose thread vanished while waiting', async () => {
    const t = convexTest(schema, modules);
    const threadId = await seedThread(t);
    const row = await seedRow(t, threadId, { status: 'claimed' as const });
    await t.run(async (ctx) => {
      const normalized = ctx.db.normalizeId('threads', threadId);
      if (normalized !== null) await ctx.db.delete(normalized);
    });

    await t.action(async (ctx) =>
      ctx.runAction(internal.chat.turn_action.runDeferredSend, {
        deferredSendId: row,
      }),
    );

    expect(await t.run(async (ctx) => ctx.db.get(row))).toBeNull();
  });
});

describe('deferred sends — settle at user append', () => {
  function recordingStore(log: string[]): TurnStore {
    return {
      async appendMessage(message) {
        log.push(`append:${message.role}`);
        return { id: 'message_1', sequence: log.length };
      },
      async streamProgress() {
        return { cancelRequested: false };
      },
      async updateAssistantParts() {
        log.push('updateAssistantParts');
      },
      async finalizeAssistantMessage() {
        log.push('finalizeAssistantMessage');
      },
      async beginGeneration() {
        log.push('beginGeneration');
      },
      async endGeneration() {
        log.push('endGeneration');
      },
    };
  }

  const message = (role: 'user' | 'assistant') => ({
    organizationId: ORG,
    threadId: 'thread_defer',
    role,
    parts: [],
  });

  it('settles the row exactly when the user message lands — the reply must not carry the tray row to its end', async () => {
    const log: string[] = [];
    const store = settleDeferredSendOnUserAppend(
      recordingStore(log),
      async () => {
        log.push('settle');
      },
    );
    await store.appendMessage(message('user'));
    await store.appendMessage(message('assistant'));
    await store.beginGeneration({ organizationId: ORG, threadId: 't' });
    expect(log).toEqual([
      'append:user',
      'settle',
      'append:assistant',
      'beginGeneration',
    ]);
  });

  it('never settles on assistant-only writes (a pre-append refusal keeps the row for the terminal settle)', async () => {
    const log: string[] = [];
    const store = settleDeferredSendOnUserAppend(
      recordingStore(log),
      async () => {
        log.push('settle');
      },
    );
    await store.appendMessage(message('assistant'));
    expect(log).toEqual(['append:assistant']);
  });

  it('a settle failure warns but never fails the append — the terminal settle retries it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const log: string[] = [];
      const store = settleDeferredSendOnUserAppend(
        recordingStore(log),
        async () => {
          throw new Error('transient settle failure');
        },
      );
      const appended = await store.appendMessage(message('user'));
      expect(appended).toEqual({ id: 'message_1', sequence: 1 });
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
