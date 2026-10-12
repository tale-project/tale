import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_TOOL_CALLS_PER_ROUND,
  runToolBatch,
  TOOL_BATCH_GRACE_MS,
  TOOL_BATCH_MAX_MS,
  TOOL_BATCH_POLL_MS,
  TOOL_CALL_INTERRUPTED_OUTPUT,
  TOOL_CALL_OVER_LIMIT_OUTPUT,
  TOOL_CALL_TIMED_OUT_OUTPUT,
} from './tool-batch';
import type { ToolCallOptions, ToolCallRequest } from './tools';

/**
 * A round's tools run under supervision. Left alone they bound nothing: any
 * number of calls, each as slow as it liked, with nothing writing the turn's
 * heartbeat while they ran — so the generation row went stale under a batch
 * that kept working, and Stop reached nothing.
 */

const call = (
  id: string,
  name = 'run_code',
  input: unknown = { id },
): ToolCallRequest => ({ id, name, input });

/** A call that answers after `ms` — or, once told to stop, at once. */
function slow(ms: number, answer: unknown = { status: 'ok' }) {
  return (_call: ToolCallRequest, options: ToolCallOptions) =>
    new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve(answer), ms);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve({ status: 'stopped-by-signal' });
        },
        { once: true },
      );
    });
}

/** A call that never looks at its signal and never ends. */
const deaf = () => new Promise<unknown>(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a round of tool calls', () => {
  it('answers each call in the order the model made them, and runs identical calls once', async () => {
    const execute = vi.fn(async (c: ToolCallRequest) => ({ ran: c.id }));
    const poll = vi.fn(async () => false);

    const { outputs } = await runToolBatch({
      calls: [
        call('1', 'rag_search', { query: 'a', limit: 3 }),
        call('2', 'rag_search', { limit: 3, query: 'a' }),
        call('3', 'rag_fetch', { ref: 'x' }),
      ],
      execute,
      poll,
    });

    // The two spellings of one question are one execution, shared.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(outputs).toEqual([{ ran: '1' }, { ran: '1' }, { ran: '3' }]);
    // A round that ends at once asks nothing of the turn.
    expect(poll).not.toHaveBeenCalled();
  });

  it('keys two broken calls alike only when they broke alike', async () => {
    const execute = vi.fn(async (c: ToolCallRequest) => ({ ran: c.id }));

    await runToolBatch({
      calls: [
        { id: '1', name: 'run_code', input: {}, rawInput: '{"a":' },
        { id: '2', name: 'run_code', input: {}, rawInput: '{"a":' },
        { id: '3', name: 'run_code', input: {}, rawInput: '{"b":' },
      ],
      execute,
      poll: async () => false,
    });

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('runs at most a round’s worth of calls and says so for the rest [CHAT-R25]', async () => {
    const execute = vi.fn(async (c: ToolCallRequest) => ({ ran: c.id }));
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 3 }, (_, i) =>
      call(String(i)),
    );

    const { outputs } = await runToolBatch({
      calls,
      execute,
      poll: async () => false,
    });

    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_ROUND);
    expect(outputs.slice(0, MAX_TOOL_CALLS_PER_ROUND)).toEqual(
      calls.slice(0, MAX_TOOL_CALLS_PER_ROUND).map((c) => ({ ran: c.id })),
    );
    // Every call is still answered: both wire dialects reject a call without
    // a result.
    expect(outputs.slice(MAX_TOOL_CALLS_PER_ROUND)).toEqual([
      TOOL_CALL_OVER_LIMIT_OUTPUT,
      TOOL_CALL_OVER_LIMIT_OUTPUT,
      TOOL_CALL_OVER_LIMIT_OUTPUT,
    ]);
  });

  it('writes the turn’s heartbeat every few seconds while the tools run, and not before [CHAT-R25]', async () => {
    const poll = vi.fn(async () => false);
    const pending = runToolBatch({
      calls: [call('1')],
      execute: slow(TOOL_BATCH_POLL_MS * 3 + 1_000),
      poll,
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS - 1);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS * 2);
    expect(poll).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toMatchObject({
      outputs: [{ status: 'ok' }],
    });
  });

  it('survives a failed heartbeat write: that is the next tick’s to repair', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poll = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('database blinked'))
      .mockResolvedValue(false);
    const pending = runToolBatch({
      calls: [call('1')],
      execute: slow(TOOL_BATCH_POLL_MS * 2 + 1_000),
      poll,
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS * 2 + 2_000);

    await expect(pending).resolves.toMatchObject({
      outputs: [{ status: 'ok' }],
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('database blinked'),
    );
  });

  it('tells every running call to stop when the reply is stopped, and keeps what they answer [CHAT-R25]', async () => {
    const seen: ToolCallOptions[] = [];
    const execute = (c: ToolCallRequest, options: ToolCallOptions) => {
      seen.push(options);
      return slow(TOOL_BATCH_MAX_MS)(c, options);
    };
    const poll = vi.fn(async () => poll.mock.calls.length >= 2);
    const pending = runToolBatch({
      calls: [call('1'), call('2')],
      execute,
      poll,
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS * 2);

    await expect(pending).resolves.toEqual({
      outputs: [
        { status: 'stopped-by-signal' },
        { status: 'stopped-by-signal' },
      ],
      // The batch itself heard the Stop: the turn does not need the row's flag
      // to read true again to know it.
      stopped: true,
    });
    expect(seen.every((options) => options.signal?.aborted === true)).toBe(
      true,
    );
  });

  it('answers for a call that does not listen once the grace has passed: it was interrupted by the Stop [CHAT-R25]', async () => {
    const poll = vi.fn(async () => true);
    const pending = runToolBatch({
      calls: [call('1', 'rag_search'), call('2')],
      execute: (c, options) =>
        c.name === 'rag_search' ? deaf() : slow(60_000)(c, options),
      poll,
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS + TOOL_BATCH_GRACE_MS);

    await expect(pending).resolves.toEqual({
      outputs: [TOOL_CALL_INTERRUPTED_OUTPUT, { status: 'stopped-by-signal' }],
      stopped: true,
    });
  });

  it('ends the round when its time is up: the calls are told, and a deaf one is answered as timed out [CHAT-R25]', async () => {
    const pending = runToolBatch({
      calls: [call('1', 'rag_search'), call('2')],
      execute: (c, options) =>
        c.name === 'rag_search'
          ? deaf()
          : slow(TOOL_BATCH_MAX_MS * 2)(c, options),
      poll: async () => false,
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_MAX_MS + TOOL_BATCH_GRACE_MS);

    // Out of time is not a Stop: the model reads the answers and goes on.
    await expect(pending).resolves.toEqual({
      outputs: [TOOL_CALL_TIMED_OUT_OUTPUT, { status: 'stopped-by-signal' }],
      stopped: false,
    });
  });

  it('does not wait out the grace when every call answers as soon as it is told', async () => {
    const pending = runToolBatch({
      calls: [call('1')],
      execute: slow(TOOL_BATCH_MAX_MS * 2),
      poll: async () => true,
    });
    let done = false;
    void pending.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(TOOL_BATCH_POLL_MS);

    expect(done).toBe(true);
  });

  it('ends the round when the turn itself ends — a worker stopping, the run’s time limit', async () => {
    const turn = new AbortController();
    const pending = runToolBatch({
      calls: [call('1')],
      execute: slow(TOOL_BATCH_MAX_MS),
      signal: turn.signal,
      poll: async () => false,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    turn.abort();
    await vi.advanceTimersByTimeAsync(0);

    // The turn ending is not a Stop either: its own signal says so.
    await expect(pending).resolves.toEqual({
      outputs: [{ status: 'stopped-by-signal' }],
      stopped: false,
    });
  });

  it('starts nothing for a turn that has already ended, and still answers every call', async () => {
    const turn = new AbortController();
    turn.abort();
    const execute = vi.fn(slow(60_000));

    const { outputs } = await runToolBatch({
      calls: [call('1'), call('2')],
      execute,
      signal: turn.signal,
      poll: async () => false,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(outputs).toEqual([
      TOOL_CALL_INTERRUPTED_OUTPUT,
      TOOL_CALL_INTERRUPTED_OUTPUT,
    ]);
  });

  it('answers a tool that broke its contract and threw, without ending the round', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { outputs } = await runToolBatch({
      calls: [call('1'), call('2', 'create_file')],
      execute: async (c) => {
        if (c.name === 'run_code') throw new Error('the executor broke');
        return { status: 'ok' };
      },
      poll: async () => false,
    });

    expect(outputs).toEqual([
      {
        status: 'error',
        message: 'The tool failed unexpectedly. Tell the user.',
      },
      { status: 'ok' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('the executor broke'),
    );
  });

  it('leaves no timer behind once the round is over', async () => {
    await runToolBatch({
      calls: [call('1')],
      execute: async () => ({ status: 'ok' }),
      poll: async () => false,
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});
