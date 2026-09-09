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

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../control/service.ts', () => ({
  isBackendDraining: vi.fn(async () => false),
}));
vi.mock('./threads.ts', () => ({
  loadOwnedThread: vi.fn(async () => ({ id: 't-1', kind: 'direct' })),
}));
vi.mock('./service.ts', () => ({ runChatTurn: vi.fn() }));
vi.mock('./store.ts', () => ({
  appendMessageRow: vi.fn(async () => ({ id: 'm-u', sequence: 0 })),
  appendAssistantErrorMessage: vi.fn(async () => undefined),
}));

import { runApiTurn } from './rest-turn.ts';
import { runChatTurn } from './service.ts';
import { appendAssistantErrorMessage, appendMessageRow } from './store.ts';

const sql = (() => {
  const tag = (..._args: unknown[]) => Promise.resolve([]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generation probe is the only query
  return tag as unknown as Sql;
})();

const payload = {
  organizationId: 'org-1',
  userId: 'user-1',
  threadId: 't-1',
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
  vi.mocked(appendMessageRow).mockClear();
  vi.mocked(appendAssistantErrorMessage).mockClear();
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
