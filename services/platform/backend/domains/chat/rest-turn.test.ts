// @vitest-environment node

/**
 * The REST turn job's failure lane. The regressions under test: a turn that
 * was refused BEFORE it persisted the caller's message (an unknown model)
 * left the thread with an assistant error row and no trace of what was
 * asked; and the stored sentence was the refusal's serialized payload
 * (`{"code":…,"message":…}`) rather than its message.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeChatError } from '../../../lib/shared/chat-errors.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { isBackendDraining } from '../control/service.ts';

const boundary = vi.hoisted(() => ({
  loadOwnedThread: vi.fn(),
  projectChatAccess: vi.fn(),
  loadProjectOrThrow: vi.fn(),
  assertThreadWriteScope: vi.fn(),
}));

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../control/service.ts', () => ({
  isBackendDraining: vi.fn(async () => false),
}));
vi.mock('./threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./threads.ts')>()),
  loadOwnedThread: boundary.loadOwnedThread,
  projectChatAccess: boundary.projectChatAccess,
}));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: boundary.loadProjectOrThrow,
}));
vi.mock('./service.ts', () => ({ runChatTurn: vi.fn() }));
vi.mock('./store.ts', () => ({
  appendMessageRow: vi.fn(async () => ({ id: 'm-u', sequence: 0 })),
  appendAssistantErrorMessage: vi.fn(async () => undefined),
  assertThreadWriteScope: boundary.assertThreadWriteScope,
}));

import { apiTurnPayloadSchema, runApiTurn } from './rest-turn.ts';
import { runChatTurn } from './service.ts';
import { appendAssistantErrorMessage, appendMessageRow } from './store.ts';
import { ChatThreadError } from './threads.ts';

/** Every statement the job ran on the pool, as text — the queued-marker
 * clear is asserted on it. */
const statements: string[] = [];
const sql = (() => {
  const tag = (strings: unknown, ..._values: unknown[]) => {
    if (Array.isArray(strings)) {
      statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    }
    return Promise.resolve([]);
  };
  const pool = Object.assign(tag, {
    begin: async (
      _options: string,
      callback: (tx: unknown) => Promise<unknown>,
    ) => callback(pool),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generation probe and transaction wrapper only
  return pool as unknown as Sql;
})();

const QUEUED_CLEAR =
  'UPDATE app.thread_metadata SET generation_queued_since_ms = NULL';

const payload = {
  organizationId: 'org-1',
  userId: 'user-1',
  threadId: 't-1',
  expectedProjectId: null,
  userText: 'Reply with PONG.',
  modelId: 'acme/nope',
};

/** A platform refusal as the turn throws it: the message is the serialized
 * payload, the sentence lives in `data.message`. */
const unknownModel = Object.assign(
  new Error('{"code":"CHAT_MODEL_UNKNOWN","message":"…"}'),
  {
    data: {
      code: 'CHAT_MODEL_UNKNOWN',
      message: 'No model "acme/nope" is available in this organization.',
    },
  },
);

beforeEach(() => {
  vi.mocked(runChatTurn).mockReset();
  boundary.loadOwnedThread.mockReset().mockResolvedValue({
    id: 't-1',
    kind: 'direct',
    projectId: null,
    archived: false,
  });
  boundary.projectChatAccess.mockReset().mockResolvedValue('ok');
  boundary.loadProjectOrThrow
    .mockReset()
    .mockResolvedValue({ archivedAt: null });
  boundary.assertThreadWriteScope.mockReset().mockResolvedValue(undefined);
  vi.mocked(isBackendDraining).mockReset().mockResolvedValue(false);
  vi.mocked(addJobInTx).mockClear();
  vi.mocked(appendMessageRow).mockClear();
  vi.mocked(appendAssistantErrorMessage).mockClear();
  statements.length = 0;
});

/**
 * What the 202 promised must reach the turn: the strict provider choice
 * (the handler's schema used to strip `providerStrict`, so the turn fell
 * back to another connector), the pre-minted reply id, and the caller's
 * effort and output cap — and the `queued` marker the 202 set must end on
 * every path the job takes, or the poll answers `queued` forever.
 */
describe('runApiTurn — what the 202 promised reaches the turn', () => {
  it('keeps every field of the accepted payload through the handler schema', () => {
    const parsed = apiTurnPayloadSchema.parse({
      ...payload,
      providerSlug: 'provider-a',
      providerStrict: true,
      assistantMessageId: 'm-pre',
      reasoningEffort: 'high',
      maxOutputTokens: 512,
      locale: 'de',
    });
    expect(parsed).toMatchObject({
      providerStrict: true,
      assistantMessageId: 'm-pre',
      reasoningEffort: 'high',
      maxOutputTokens: 512,
      locale: 'de',
    });
    expect(() =>
      apiTurnPayloadSchema.parse({ ...payload, reasoningEffort: 'ultra' }),
    ).toThrow();
  });

  it('hands the pre-minted id, the effort and the cap to the turn, then clears the queued marker', async () => {
    vi.mocked(runChatTurn).mockResolvedValue({ status: 'completed' } as never);
    await runApiTurn(sql, {
      ...payload,
      assistantMessageId: 'm-pre',
      reasoningEffort: 'low',
      maxOutputTokens: 256,
    });
    expect(runChatTurn).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        placeholderId: 'm-pre',
        reasoningEffort: 'low',
        maxOutputTokens: 256,
      }),
    );
    expect(statements.some((text) => text.startsWith(QUEUED_CLEAR))).toBe(true);
  });

  it('settles a refusal under the promised id and clears the marker on an early return', async () => {
    vi.mocked(runChatTurn).mockRejectedValue(unknownModel);
    await runApiTurn(sql, { ...payload, assistantMessageId: 'm-pre' });
    expect(appendAssistantErrorMessage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ id: 'm-pre' }),
    );
    expect(statements.some((text) => text.startsWith(QUEUED_CLEAR))).toBe(true);
    statements.length = 0;
    // A thread that moved scope: the job returns without a turn — and the
    // marker still ends.
    boundary.loadOwnedThread.mockResolvedValue(null);
    await runApiTurn(sql, { ...payload, assistantMessageId: 'm-pre' });
    expect(runChatTurn).toHaveBeenCalledTimes(1);
    expect(statements.some((text) => text.startsWith(QUEUED_CLEAR))).toBe(true);
  });

  it('keeps the marker when the drain window re-queues the accepted send', async () => {
    vi.mocked(isBackendDraining).mockResolvedValue(true);
    await runApiTurn(sql, { ...payload, assistantMessageId: 'm-pre' });
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      expect.objectContaining({ assistantMessageId: 'm-pre' }),
      expect.anything(),
    );
    expect(statements.some((text) => text.startsWith(QUEUED_CLEAR))).toBe(
      false,
    );
  });
});

describe('runApiTurn — the accepted scope is checked again before execution', () => {
  it('does not copy the submitted text into a moved thread after a provider resolution error', async () => {
    vi.mocked(runChatTurn).mockImplementation(async () => {
      boundary.assertThreadWriteScope.mockRejectedValue(
        new ChatThreadError('THREAD_SCOPE_CHANGED', 'moved', 409),
      );
      throw unknownModel;
    });
    await runApiTurn(sql, payload);
    expect(boundary.assertThreadWriteScope).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ projectId: null }),
    );
    expect(appendMessageRow).not.toHaveBeenCalled();
    expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
  });

  it('does not record another error after the atomic turn-open guard refuses a late move', async () => {
    vi.mocked(runChatTurn).mockRejectedValue(
      new ChatThreadError('THREAD_SCOPE_CHANGED', 'moved', 409),
    );
    await runApiTurn(sql, payload);
    expect(appendMessageRow).not.toHaveBeenCalled();
    expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
  });

  it.each([
    { expected: null, actual: 'p-a' },
    { expected: 'p-a', actual: null },
    { expected: 'p-a', actual: 'p-b' },
  ])(
    'does not send after the thread moves from $expected to $actual',
    async ({ expected, actual }) => {
      boundary.loadOwnedThread.mockResolvedValue({
        id: 't-1',
        kind: 'direct',
        projectId: actual,
        archived: false,
      });
      await runApiTurn(sql, { ...payload, expectedProjectId: expected });
      expect(runChatTurn).not.toHaveBeenCalled();
      expect(appendMessageRow).not.toHaveBeenCalled();
      expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { id: 't-1', kind: 'direct', projectId: null, archived: true },
    { id: 't-1', kind: 'sandbox', projectId: null, archived: false },
  ])(
    'does not spend or write into an unavailable thread: %j',
    async (thread) => {
      boundary.loadOwnedThread.mockResolvedValue(thread);
      await runApiTurn(sql, payload);
      expect(runChatTurn).not.toHaveBeenCalled();
      expect(appendMessageRow).not.toHaveBeenCalled();
      expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
    },
  );

  it.each(['not_found', 'forbidden'])(
    'does not run when project access changed to %s',
    async (access) => {
      boundary.loadOwnedThread.mockResolvedValue({
        id: 't-1',
        kind: 'direct',
        projectId: 'p-a',
        archived: false,
      });
      boundary.projectChatAccess.mockResolvedValue(access);
      await runApiTurn(sql, { ...payload, expectedProjectId: 'p-a' });
      expect(runChatTurn).not.toHaveBeenCalled();
      expect(appendMessageRow).not.toHaveBeenCalled();
      expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
    },
  );

  it('does not run when the project was archived after acceptance', async () => {
    boundary.loadOwnedThread.mockResolvedValue({
      id: 't-1',
      kind: 'direct',
      projectId: 'p-a',
      archived: false,
    });
    boundary.loadProjectOrThrow.mockResolvedValue({ archivedAt: 10 });
    await runApiTurn(sql, { ...payload, expectedProjectId: 'p-a' });
    expect(runChatTurn).not.toHaveBeenCalled();
    expect(appendMessageRow).not.toHaveBeenCalled();
    expect(appendAssistantErrorMessage).not.toHaveBeenCalled();
  });

  it('executes an unchanged project scope with current read permission and the chosen provider', async () => {
    boundary.loadOwnedThread.mockResolvedValue({
      id: 't-1',
      kind: 'direct',
      projectId: 'p-a',
      archived: false,
    });
    vi.mocked(runChatTurn).mockRejectedValue(unknownModel);
    await runApiTurn(sql, {
      ...payload,
      expectedProjectId: 'p-a',
      providerSlug: 'provider-a',
    });
    expect(boundary.projectChatAccess).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      projectId: 'p-a',
    });
    expect(runChatTurn).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ threadId: 't-1', providerSlug: 'provider-a' }),
    );
  });

  it('carries the accepted provider as a strict choice into the turn', async () => {
    boundary.loadOwnedThread.mockResolvedValue({
      id: 't-1',
      kind: 'direct',
      projectId: null,
      archived: false,
    });
    vi.mocked(runChatTurn).mockRejectedValue(unknownModel);
    await runApiTurn(sql, {
      ...payload,
      providerSlug: 'provider-a',
      providerStrict: true,
    });
    // The 202 promised this provider; the turn must refuse a pair that
    // stopped resolving rather than fall back to another connector.
    expect(runChatTurn).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        providerSlug: 'provider-a',
        providerStrict: true,
      }),
    );
  });

  it('preserves the exact accepted scope when drain requeues the job', async () => {
    vi.mocked(isBackendDraining).mockResolvedValue(true);
    const accepted = { ...payload, expectedProjectId: 'p-a' };
    await runApiTurn(sql, accepted);
    expect(addJobInTx).toHaveBeenCalledWith(
      sql,
      'chat.api_turn',
      accepted,
      expect.objectContaining({ startAfter: expect.any(Date) }),
    );
    expect(runChatTurn).not.toHaveBeenCalled();
  });
});

/**
 * The job's busy verdict dropped the accepted prompt and filed the failure
 * under `generic`; and the marker clear in `finally` cleared whatever
 * marker the thread held — a later send's included.
 */
describe('runApiTurn — the thread is busy when the job runs', () => {
  it('records the accepted prompt beside a thread_busy failure, and clears only its own marker', async () => {
    const busyStatements: string[] = [];
    const busySql = (() => {
      const tag = (strings: unknown, ..._values: unknown[]) => {
        if (!Array.isArray(strings)) return Promise.resolve([]);
        const text = strings.join('?').replace(/\s+/g, ' ').trim();
        busyStatements.push(text);
        return Promise.resolve(
          text.startsWith('SELECT thread_id AS "threadId" FROM app.generations')
            ? [{ threadId: 't-1' }]
            : [],
        );
      };
      const pool = Object.assign(tag, {
        begin: async (
          _options: string,
          callback: (tx: unknown) => Promise<unknown>,
        ) => callback(pool),
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generation probe and transaction wrapper only
      return pool as unknown as Sql;
    })();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runApiTurn(busySql, { ...payload, assistantMessageId: 'm-promised' });
    warn.mockRestore();

    expect(runChatTurn).not.toHaveBeenCalled();
    expect(appendMessageRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'user', text: 'Reply with PONG.' }),
    );
    const failure = vi.mocked(appendAssistantErrorMessage).mock.calls[0]?.[1];
    expect(failure).toMatchObject({ id: 'm-promised' });
    expect(decodeChatError(failure?.error)).toMatchObject({
      code: 'thread_busy',
      raw: 'This conversation was already generating a response.',
    });
    // The clear is scoped to the marker this job's 202 set.
    const clear = busyStatements.find((s) => s.startsWith(QUEUED_CLEAR));
    expect(clear).toContain('stream_id = ?');
  });
});

describe('runApiTurn — a refusal before the user message landed', () => {
  it('persists the caller’s message, then the error row with the sentence', async () => {
    vi.mocked(runChatTurn).mockRejectedValue(unknownModel);
    await runApiTurn(sql, payload);

    expect(appendMessageRow).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        threadId: 't-1',
        role: 'user',
        text: 'Reply with PONG.',
        parts: [{ type: 'text', text: 'Reply with PONG.' }],
      }),
    );
    const errorRow = vi.mocked(appendAssistantErrorMessage).mock.calls[0]?.[1];
    expect(decodeChatError(errorRow?.error)).toMatchObject({
      raw: 'No model "acme/nope" is available in this organization.',
      model: 'acme/nope',
    });
    // The user row goes first, so the thread reads as question then failure.
    expect(
      vi.mocked(appendMessageRow).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(appendAssistantErrorMessage).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('adds no second user row when the turn had already persisted it', async () => {
    vi.mocked(runChatTurn).mockImplementation(async (_sql, request) => {
      await request.onUserMessageAppended?.();
      throw new Error('provider exploded');
    });
    await runApiTurn(sql, payload);
    expect(appendMessageRow).not.toHaveBeenCalled();
    expect(appendAssistantErrorMessage).toHaveBeenCalledTimes(1);
  });
});
