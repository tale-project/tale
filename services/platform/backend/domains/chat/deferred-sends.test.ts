// @vitest-environment node

/**
 * The parked send's ordering contract: the video claim, the row and its
 * readiness poll commit TOGETHER, claim first and poll last — the poll wakes
 * on the commit (pg-boss LISTEN/NOTIFY) and must find the whole row, never a
 * video-only send whose ids a post-commit claim was still about to write.
 * The real-Postgres run rides `integration-check.ts`; this locks the
 * statement order and what the row carries.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx, loadOwnedThread, runChatTurn, isBackendDraining } =
  vi.hoisted(() => ({
    addJobInTx: vi.fn(),
    loadOwnedThread: vi.fn(),
    runChatTurn: vi.fn(),
    isBackendDraining: vi.fn(),
  }));

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('./threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./threads.ts')>()),
  loadOwnedThread,
}));
vi.mock('./service.ts', () => ({ runChatTurn }));
vi.mock('../control/service.ts', () => ({ isBackendDraining }));

import { enqueueDeferredSend, pollDeferredSend } from './deferred-sends.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * A transaction-aware fake `sql`. Every statement — pool or transaction —
 * and every job send lands on ONE timeline, so a test can prove not just
 * what ran but in which order and on which connection.
 */
function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  timeline: Array<{
    lane: 'pool' | 'tx' | 'job';
    text: string;
    values: unknown[];
  }>;
} {
  const timeline: Array<{
    lane: 'pool' | 'tx' | 'job';
    text: string;
    values: unknown[];
  }> = [];
  const makeTag = (lane: 'pool' | 'tx') => {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      timeline.push({ lane, text, values });
      return Promise.resolve(answer({ text, values }) ?? []);
    };
    tag.json = (value: unknown) => ({ json: value });
    tag.unsafe = (text: string) => text;
    return tag;
  };
  const pooled = Object.assign(makeTag('pool'), {
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(makeTag('tx')),
  });
  addJobInTx.mockImplementation(
    (_sql: unknown, name: string, data: Record<string, unknown>) => {
      timeline.push({ lane: 'job', text: name, values: [data] });
      return Promise.resolve('job-id');
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the deferred-send lane exercises exactly the tag, json, unsafe and begin surfaces faked here
  return { sql: pooled as unknown as Sql, timeline };
}

const PARK = {
  organizationId: 'org_1',
  userId: 'user_1',
  threadId: 'thread_1',
  modelId: 'z-ai/glm-5.1',
};

beforeEach(() => {
  vi.clearAllMocks();
  loadOwnedThread.mockResolvedValue({ id: 'thread_1' });
  isBackendDraining.mockResolvedValue(false);
});

describe('enqueueDeferredSend', () => {
  it('claims the videos inside the park transaction, writes them on the row, and enqueues the poll last', async () => {
    const f = fakeSql(({ text, values }) => {
      if (text.includes('UPDATE app.video_link_jobs')) {
        return values.includes('job_1') ? [{ id: 'job_1' }] : [];
      }
      if (text.includes('INSERT INTO app.deferred_sends'))
        return [{ id: 'ds_1' }];
      if (text.includes('count(*)')) return [{ count: '0' }];
      return undefined;
    });

    await expect(
      enqueueDeferredSend(f.sql, {
        ...PARK,
        userText: '',
        videoJobIds: ['job_1', 'job_foreign'],
      }),
    ).resolves.toEqual({ deferredSendId: 'ds_1' });

    // Nothing ran on the pool: claim, insert and poll all rode the tx.
    expect(f.timeline.every((entry) => entry.lane !== 'pool')).toBe(true);
    const order = f.timeline.map((entry) =>
      entry.lane === 'job'
        ? `job:${entry.text}`
        : entry.text.includes('UPDATE app.video_link_jobs')
          ? 'claim'
          : entry.text.includes('INSERT INTO app.deferred_sends')
            ? 'insert'
            : 'other',
    );
    expect(order).toEqual([
      'other',
      'claim',
      'claim',
      'insert',
      'job:chat.deferred_send_poll',
    ]);
    // The row carries exactly the CLAIMED set — the foreign id was dropped.
    const insert = f.timeline.find((entry) =>
      entry.text.includes('INSERT INTO app.deferred_sends'),
    );
    expect(insert?.values).toContainEqual(['job_1']);
    const poll = f.timeline.find((entry) => entry.lane === 'job');
    expect(poll?.values[0]).toEqual({ deferredSendId: 'ds_1' });
  });

  it('refuses a video-only send whose ids were all unclaimable instead of parking an empty message', async () => {
    const f = fakeSql(({ text }) => {
      if (text.includes('count(*)')) return [{ count: '0' }];
      return [];
    });

    await expect(
      enqueueDeferredSend(f.sql, {
        ...PARK,
        userText: '',
        videoJobIds: ['job_gone'],
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_MESSAGE' });
    expect(
      f.timeline.some((entry) =>
        entry.text.includes('INSERT INTO app.deferred_sends'),
      ),
    ).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('pollDeferredSend', () => {
  it('keeps a video-only row parked while its claimed job is still ingesting', async () => {
    const f = fakeSql(({ text }) => {
      if (text.includes('FROM app.deferred_sends')) {
        return [
          {
            id: 'ds_1',
            organizationId: 'org_1',
            userId: 'user_1',
            threadId: 'thread_1',
            userText: '',
            attachments: null,
            modelId: 'z-ai/glm-5.1',
            modelSelection: null,
            providerSlug: null,
            reasoningEffort: null,
            locale: 'en',
            status: 'waiting',
            createdAt: 1,
            waitingSince: Date.now(),
            videoJobIds: ['job_1'],
          },
        ];
      }
      if (text.includes('FROM app.video_link_jobs')) {
        return [{ status: 'ingesting', transcriptionStatus: null }];
      }
      return undefined;
    });

    await expect(pollDeferredSend(f.sql, 'ds_1')).resolves.toBe('waiting');
    expect(runChatTurn).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledWith(
      f.sql,
      'chat.deferred_send_poll',
      { deferredSendId: 'ds_1' },
      expect.objectContaining({ singletonKey: 'ds_1' }),
    );
  });
});
