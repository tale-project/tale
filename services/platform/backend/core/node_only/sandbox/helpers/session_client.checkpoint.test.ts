import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HarnessJsonlRecordTooLargeError,
  LineReassembler,
  MAX_HARNESS_JSONL_RECORD_BYTES,
} from '../../../../../lib/harnesses/jsonl';
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('durable exec checkpoint transport', () => {
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
