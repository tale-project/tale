import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HarnessJsonlRecordTooLargeError,
  LineReassembler,
  MAX_HARNESS_JSONL_RECORD_BYTES,
} from '../../../../../lib/harnesses/jsonl';
import { drainHarnessWindow } from '../../../chat/external_turn_shared';
import {
  drainSessionExecResilient,
  sessionAcquire,
  sessionGetExecCheckpoint,
  sessionPutExecCheckpoint,
  SpawnerBusyError,
} from './session_client';

beforeEach(() => {
  vi.stubEnv('SANDBOX_TOKEN', 'checkpoint-client-test');
  vi.stubEnv('SANDBOX_URL', 'http://sandbox.test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('durable exec checkpoint transport', () => {
  it.each([false, true])(
    'preserves a live background task through real checkpoint retries (gap recovery: %s)',
    async (recoverGap) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let stored: unknown = null;
      let resumed = false;
      let gapSent = false;
      const failures = [503, new TypeError('temporary socket failure')];
      const attachSequences: number[] = [];
      let cancellations = 0;
      const result = {
        type: 'result',
        subtype: 'success',
        session_id: 'claude-retry',
        result: 'Background report is still being generated.',
      };
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname.endsWith('/checkpoint')) {
            if (init?.method === 'PUT') {
              if (typeof init.body !== 'string')
                throw new Error('checkpoint writes need a JSON string');
              stored = JSON.parse(init.body);
              return Response.json({ ok: true });
            }
            if (resumed && (!recoverGap || gapSent)) {
              const failure = failures.shift();
              if (typeof failure === 'number')
                return new Response(null, { status: failure });
              if (failure) throw failure;
              if (recoverGap && stored !== null && typeof stored === 'object')
                return Response.json({ checkpoint: { ...stored, seq: 9 } });
            }
            return Response.json({ checkpoint: stored });
          }
          if (url.pathname.endsWith('/cancel')) {
            cancellations += 1;
            return Response.json({ cancelled: true });
          }
          if (!url.pathname.endsWith('/attach'))
            throw new Error(`unexpected request: ${url.pathname}`);
          attachSequences.push(Number(url.searchParams.get('sinceSeq') ?? 0));
          const signal = init?.signal;
          if (!signal) throw new Error('attach needs its deadline');
          signal.throwIfAborted();
          if (resumed && recoverGap && !gapSent) {
            gapSent = true;
            return new Response(
              'event: gap\ndata: {"fromSeq":8,"toSeq":9}\n\n',
            );
          }
          const events = resumed
            ? [result]
            : [
                { type: 'system', subtype: 'init', session_id: 'claude-retry' },
                {
                  type: 'system',
                  subtype: 'task_started',
                  task_id: 'report',
                  description: 'Background report',
                },
                result,
              ];
          let onAbort: () => void;
          return new Response(
            new ReadableStream({
              start(controller) {
                const text =
                  events.map((event) => JSON.stringify(event)).join('\n') +
                  '\n';
                controller.enqueue(
                  new TextEncoder().encode(
                    `event: replay-start\ndata: {}\n\nevent: stdout\ndata: ${JSON.stringify({ seq: resumed ? 8 : 7, text })}\n\nevent: replay-complete\ndata: ${JSON.stringify({ throughSeq: resumed ? 8 : 7 })}\n\n`,
                  ),
                );
                onAbort = () => controller.error(signal.reason);
                signal.addEventListener('abort', onAbort, { once: true });
              },
              cancel() {
                signal.removeEventListener('abort', onAbort);
              },
            }),
          );
        });
      vi.stubGlobal('fetch', fetcher);
      const args = {
        sessionId: 'session',
        execId: 'exec',
        harness: 'claude-code',
        windowMs: 30,
      };
      expect((await drainHarnessWindow(args)).kind).toBe('running');
      expect(stored).toMatchObject({
        seq: 7,
        state: { pendingTasks: ['report'] },
      });
      resumed = true;
      expect((await drainHarnessWindow(args)).kind).toBe('running');
      expect(failures).toHaveLength(0);
      expect(attachSequences).toEqual(recoverGap ? [0, 7, 9] : [0, 7]);
      expect(stored).toMatchObject({
        seq: recoverGap ? 9 : 8,
        state: { pendingTasks: ['report'] },
      });
      expect(cancellations).toBe(0);
    },
  );

  it.each([408, 429, 500, 502, 503, 504])(
    'recovers a checkpoint after a transient HTTP %s without restarting replay',
    async (status) => {
      vi.useFakeTimers();
      const checkpoint = { seq: 42, state: { partial: 'unfinished' } };
      const cancelled = vi.fn();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(new ReadableStream({ cancel: cancelled }), { status }),
        )
        .mockResolvedValueOnce(Response.json({ checkpoint }));
      vi.stubGlobal('fetch', fetcher);
      const result = sessionGetExecCheckpoint('session', 'exec');
      await vi.advanceTimersByTimeAsync(499);
      expect(fetcher).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual(checkpoint);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(cancelled).toHaveBeenCalledOnce();
      expect(
        new Headers(fetcher.mock.calls[0]?.[1]?.headers).get(
          'x-tale-sandbox-nonce',
        ),
      ).not.toBe(
        new Headers(fetcher.mock.calls[1]?.[1]?.headers).get(
          'x-tale-sandbox-nonce',
        ),
      );
    },
  );

  it.each([
    new TypeError('fetch failed'),
    new DOMException('request timed out', 'TimeoutError'),
    new DOMException('body read aborted', 'AbortError'),
  ])('recovers a checkpoint after a transient %s', async (error) => {
    vi.useFakeTimers();
    const checkpoint = { seq: 7, state: { pendingTasks: ['task'] } };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(Response.json({ checkpoint }));
    vi.stubGlobal('fetch', fetcher);
    const result = sessionGetExecCheckpoint('session', 'exec');
    await vi.runAllTimersAsync();
    expect(await result).toEqual(checkpoint);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly after the bounded checkpoint retry budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const started = Date.now();
    const failure = expect(
      sessionGetExecCheckpoint('session', 'exec'),
    ).rejects.toThrow('checkpoint read failed (503)');
    await vi.runAllTimersAsync();
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(Date.now() - started).toBe(7_500);
  });

  it.each([400, 401, 403, 409, 422, 501])(
    'does not retry non-transient HTTP %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal('fetch', fetcher);
      await expect(sessionGetExecCheckpoint('session', 'exec')).rejects.toThrow(
        `checkpoint read failed (${status})`,
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    '{not-json',
    JSON.stringify({ checkpoint: { seq: -1, state: {} } }),
    JSON.stringify({}),
  ])('does not retry an invalid checkpoint response: %s', async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    vi.stubGlobal('fetch', fetcher);
    await expect(sessionGetExecCheckpoint('session', 'exec')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('fails missing credentials before making a checkpoint request', async () => {
    vi.stubEnv('SANDBOX_TOKEN', '');
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    await expect(sessionGetExecCheckpoint('session', 'exec')).rejects.toThrow(
      'SANDBOX_TOKEN',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'not-a-url',
    'file:///tmp/sandbox',
    'http://user:password@sandbox.test',
  ])(
    'fails invalid URL configuration before making a checkpoint request',
    async (url) => {
      vi.stubEnv('SANDBOX_URL', url);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetcher);
      await expect(
        sessionGetExecCheckpoint('session', 'exec'),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('signs the session and exec for the atomic snapshot and validates readback', async () => {
    const checkpoint = {
      seq: 42,
      state: { parser: { partial: 'unfinished' } },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ checkpoint }));
    vi.stubGlobal('fetch', fetcher);
    await sessionPutExecCheckpoint('session/a', 'exec:b', checkpoint);
    expect(await sessionGetExecCheckpoint('session/a', 'exec:b')).toEqual(
      checkpoint,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      'http://sandbox.test/v1/sessions/session%2Fa/exec/exec%3Ab/checkpoint',
    );
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify(checkpoint));
    expect(new Headers(init?.headers).get('x-tale-sandbox-signature')).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('uses the legacy replay path when an old runtime has no checkpoint endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(null, { status: 404 })),
    );
    expect(await sessionGetExecCheckpoint('session', 'exec')).toBeNull();
    await expect(
      sessionPutExecCheckpoint('session', 'exec', { seq: 1, state: {} }),
    ).resolves.toBeUndefined();
  });

  it('never acknowledges a parser state larger than the receiver can persist', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    await sessionPutExecCheckpoint('session', 'exec', {
      seq: 1,
      state: 'x'.repeat(1024 * 1024),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not replay acknowledged events into parser or usage accounting', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            [
              'event: stdout\ndata: {"seq":4,"text":"old"}\n\n',
              'event: stdout\ndata: {"seq":5,"text":"new"}\n\n',
              'event: stdout\ndata: {"seq":5,"text":"duplicate"}\n\n',
              'event: result\ndata: {"exitCode":0}\n\n',
            ].join(''),
          ),
        ),
    );
    const onStdout = vi.fn();
    const cursor = { lastSeq: 4 };
    await drainSessionExecResilient(
      'session',
      { execId: 'exec' },
      new AbortController().signal,
      { onStdout },
      { resumeSinceSeq: 4, cursor },
    );
    expect(onStdout.mock.calls).toEqual([['new']]);
    expect(cursor.lastSeq).toBe(5);
  });

  it('surfaces a parser record overflow without retrying or acknowledging rejected bytes', async () => {
    const parser = new LineReassembler();
    parser.push('x'.repeat(MAX_HARNESS_JSONL_RECORD_BYTES));
    const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: stdout\ndata: {"seq":5,"text":"overflow"}\n\n',
              ),
            );
          },
          cancel: cancelled,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const cursor = { lastSeq: 4 };
    await expect(
      drainSessionExecResilient(
        'session',
        { execId: 'exec' },
        new AbortController().signal,
        {
          onStdout: (text) => {
            parser.push(text);
          },
        },
        { cursor, resumeSinceSeq: 4 },
      ),
    ).rejects.toBeInstanceOf(HarnessJsonlRecordTooLargeError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cursor.lastSeq).toBe(4);
  });

  it('reports an irrecoverable replay gap immediately and closes the stream', async () => {
    const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: gap\ndata: {"fromSeq":1,"toSeq":9}\n\n',
              ),
            );
          },
          cancel: cancelled,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const onStdout = vi.fn();
    await expect(
      drainSessionExecResilient(
        'session',
        { execId: 'exec' },
        new AbortController().signal,
        { onStdout },
        { resumeSinceSeq: 1 },
      ),
    ).rejects.toMatchObject({
      name: 'ExecReplayGapError',
      fromSeq: 1,
      toSeq: 9,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(onStdout).not.toHaveBeenCalled();
  });

  it.each(['host_memory', 'host_disk'])(
    'parks warm acquisition refused for %s',
    async (reason) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(
            {
              error: 'spawner_busy',
              reason,
              retryAfterMs: 1000,
            },
            { status: 429 },
          ),
        ),
      );
      await expect(sessionAcquire('session')).rejects.toBeInstanceOf(
        SpawnerBusyError,
      );
    },
  );
});
