// @vitest-environment node

/**
 * The parked send's contracts, on a fake `sql`:
 *
 *  - park: the video claim, the row and its readiness poll commit TOGETHER,
 *    claim first and poll last — the poll wakes on the commit (pg-boss
 *    LISTEN/NOTIFY) and must find the whole row, never a video-only send
 *    whose ids a post-commit claim was still about to write;
 *  - fire: the tray row settles the moment the turn persists the user
 *    message (never bubble + "sending" row together), and a send the turn
 *    refused or dropped BEFORE that write leaves its trace in the thread
 *    instead of vanishing.
 *
 * The real-Postgres run rides `integration-check.ts`; this locks the
 * statement order and what the rows carry.
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

describe('pollDeferredSend — settle at user append, trace on failure', () => {
  const READY_ROW = {
    id: 'ds_1',
    organizationId: 'org_1',
    userId: 'user_1',
    threadId: 'thread_1',
    userText: 'Summarize this',
    attachments: null,
    modelId: 'z-ai/glm-5.1',
    modelSelection: null,
    providerSlug: null,
    reasoningEffort: null,
    locale: 'en',
    status: 'waiting',
    createdAt: 1,
    waitingSince: Date.now(),
    videoJobIds: null,
  };

  function readySql() {
    let order = 0;
    return fakeSql(({ text }) => {
      if (text.includes('FROM app.deferred_sends')) return [READY_ROW];
      if (text.includes('UPDATE app.deferred_sends')) return [{ id: 'ds_1' }];
      if (text.includes('INSERT INTO app.messages')) {
        order += 1;
        return [{ id: `m_${order}`, order }];
      }
      return [];
    });
  }

  const messageInserts = (timeline: ReturnType<typeof fakeSql>['timeline']) =>
    timeline.filter((entry) => entry.text.includes('INSERT INTO app.messages'));
  const settleIndex = (timeline: ReturnType<typeof fakeSql>['timeline']) =>
    timeline.findIndex((entry) =>
      entry.text.includes('DELETE FROM app.deferred_sends'),
    );

  it('settles the tray row the moment the user message is durable, before the turn settles', async () => {
    const f = readySql();
    let settledBeforeTurnEnd = false;
    runChatTurn.mockImplementation(
      async (
        _sql: unknown,
        request: { onUserMessageAppended?: () => Promise<void> },
      ) => {
        await request.onUserMessageAppended?.();
        settledBeforeTurnEnd = settleIndex(f.timeline) !== -1;
        return { status: 'completed', steps: ['done'], text: 'ok' };
      },
    );

    await expect(pollDeferredSend(f.sql, 'ds_1')).resolves.toBe('ran');
    expect(settledBeforeTurnEnd).toBe(true);
    // A completed turn wrote its own rows through the store — no trace.
    expect(messageInserts(f.timeline)).toHaveLength(0);
  });

  it('leaves the user row and an assistant error row when the turn is refused before the pipeline opened', async () => {
    runChatTurn.mockResolvedValue({
      status: 'refused',
      steps: [],
      step: 'input-guardrails',
      reason: 'Model "z-ai/glm-5.1" is not available for your account.',
    });
    const f = readySql();

    await expect(pollDeferredSend(f.sql, 'ds_1')).resolves.toBe('ran');
    const inserts = messageInserts(f.timeline);
    expect(inserts).toHaveLength(2);
    // values: thread, org, role, parts, text, model, provider, usage,
    // blockedReason, truncation, error, status, now, thread
    expect(inserts[0]?.values[2]).toBe('user');
    expect(inserts[0]?.values[3]).toEqual({
      json: [{ type: 'text', text: 'Summarize this' }],
    });
    expect(inserts[0]?.values[4]).toBe('Summarize this');
    expect(inserts[1]?.values[2]).toBe('assistant');
    expect(inserts[1]?.values[5]).toBe('z-ai/glm-5.1');
    expect(String(inserts[1]?.values[10])).toMatch(/^TALE_ERR1 /);
    expect(String(inserts[1]?.values[10])).toContain(
      'is not available for your account',
    );
    // The trace lands BEFORE the tray row settles: no window with neither.
    const settleAt = settleIndex(f.timeline);
    expect(settleAt).toBeGreaterThan(f.timeline.indexOf(inserts[1]!));
  });

  it('leaves no second trace for a guardrail refusal — the pipeline appended its blocked row', async () => {
    runChatTurn.mockResolvedValue({
      status: 'refused',
      steps: ['input-guardrails'],
      step: 'input-guardrails',
      reason: 'Blocked by the input filter.',
    });
    const f = readySql();

    await expect(pollDeferredSend(f.sql, 'ds_1')).resolves.toBe('ran');
    expect(messageInserts(f.timeline)).toHaveLength(0);
    expect(settleIndex(f.timeline)).not.toBe(-1);
  });

  it('traces a turn that threw before the user message was appended, settles the row, then rethrows', async () => {
    runChatTurn.mockRejectedValue(new Error('Unknown model "z-ai/glm-5.1"'));
    const f = readySql();

    await expect(pollDeferredSend(f.sql, 'ds_1')).rejects.toThrow(
      'Unknown model',
    );
    const inserts = messageInserts(f.timeline);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values[2]).toBe('user');
    expect(inserts[1]?.values[2]).toBe('assistant');
    expect(String(inserts[1]?.values[10])).toContain('Unknown model');
    expect(settleIndex(f.timeline)).toBeGreaterThan(
      f.timeline.indexOf(inserts[1]!),
    );
  });

  it('adds no trace for a failure the placeholder already carries', async () => {
    runChatTurn.mockImplementation(
      async (
        _sql: unknown,
        request: { onUserMessageAppended?: () => Promise<void> },
      ) => {
        await request.onUserMessageAppended?.();
        throw new Error('stream died');
      },
    );
    const f = readySql();

    await expect(pollDeferredSend(f.sql, 'ds_1')).rejects.toThrow(
      'stream died',
    );
    expect(messageInserts(f.timeline)).toHaveLength(0);
  });
});
