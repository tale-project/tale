import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { rejects } from 'node:assert/strict';

import { withOperationBudget } from '../operation-budget.ts';
import {
  answeringIncarnation,
  RunnerdActivityError,
  runnerdActivity,
  runnerdAttach,
  runnerdExec,
  runnerdReadFile,
  runnerdStageFiles,
  RunnerdStageBusyError,
  runnerdEnvPatch,
  waitForRunnerd,
  RunnerdMemoryBusyError,
  runnerdOpenExec,
  RunnerdOutputGapError,
  RunnerdProtocolError,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';

const completed: RunnerdExecEvent = {
  t: 'exit',
  exitCode: 0,
  durationMs: 1,
  truncated: { stdout: false, stderr: false },
  timedOut: false,
  cancelled: false,
  seq: 2,
};

test('readiness waits for required Docker while liveness already answers', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ ok: true, dockerReady: false }))
    .mockResolvedValueOnce(Response.json({ ok: true, dockerReady: false }))
    .mockResolvedValue(Response.json({ ok: true, dockerReady: true }));
  try {
    await waitForRunnerd(
      { baseUrl: 'http://runnerd.invalid', token: 'test' },
      1000,
      1,
    );
    expect(fetch.mock.calls).toHaveLength(3);
  } finally {
    fetch.mockRestore();
  }
});

test('the overall readiness deadline cancels an unresponsive health probe', async () => {
  let cancelled = false;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (
        _input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error('missing probe deadline');
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      { preconnect() {} },
    ),
  );
  try {
    await rejects(
      waitForRunnerd(
        { baseUrl: 'http://runnerd.invalid', token: 'test' },
        50,
        1000,
      ),
      /runnerd did not become ready within 50ms/,
    );
    expect(cancelled).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});

test('the inherited startup budget cancels readiness before its own deadline', async () => {
  let cancelled = false;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (
        _input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error('missing inherited deadline');
          signal.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      { preconnect() {} },
    ),
  );
  try {
    await rejects(
      withOperationBudget(25, () =>
        waitForRunnerd(
          { baseUrl: 'http://runnerd.invalid', token: 'test' },
          1000,
          1,
        ),
      ),
      /sandbox operation deadline exceeded/,
    );
    expect(cancelled).toBe(true);
  } finally {
    fetch.mockRestore();
  }
});

for (const mode of ['exec', 'attach'] as const) {
  describe(`runnerd ${mode} protocol`, () => {
    const consume = (onEvent: (event: RunnerdExecEvent) => void) => {
      const client = { baseUrl: 'http://runnerd.invalid', token: 'test' };
      return mode === 'attach'
        ? runnerdAttach(client, 'test', onEvent)
        : runnerdExec(
            client,
            {
              execId: 'test',
              command: ['true'],
              timeoutMs: 1000,
              stdoutMaxBytes: 0,
              stderrMaxBytes: 0,
            },
            onEvent,
          );
    };

    for (const [name, line] of [
      ['malformed JSON', '{broken'],
      ['unknown event', JSON.stringify({ t: 'unknown' })],
      ['invalid base64', JSON.stringify({ t: 'stdout', b64: '!bad', seq: 1 })],
      [
        'unsafe sequence',
        JSON.stringify({ t: 'stdout', b64: 'YQ==', seq: 1.5 }),
      ],
      ['incomplete exit', JSON.stringify({ t: 'exit', exitCode: 0 })],
      [
        'invalid replay marker',
        JSON.stringify({ t: 'replay-complete', throughSeq: -1 }),
      ],
      [
        'oversized complete line',
        JSON.stringify({ t: 'stdout', b64: 'A'.repeat(1024 * 1024 + 4) }),
      ],
    ]) {
      test(`refuses ${name} before a later success and cancels the body`, async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `${line}\n${JSON.stringify(completed)}\n`,
              ),
            );
          },
          cancel() {
            cancelled = true;
          },
        });
        const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(body),
        );
        const seen: RunnerdExecEvent[] = [];
        try {
          await rejects(
            consume((event) => seen.push(event)),
            /runnerd protocol/,
          );
          expect(seen).toEqual([]);
          expect(cancelled).toBe(true);
        } finally {
          fetch.mockRestore();
        }
      });
    }

    test('propagates callback failures unchanged and cancels the body', async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `${JSON.stringify({ ...completed, seq: 1 })}\n`,
            ),
          );
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(body),
      );
      const error = new Error('consumer failed');
      try {
        await rejects(
          consume(() => {
            throw error;
          }),
          (failure: unknown) => failure === error,
        );
        expect(body.locked).toBe(false);
        // A closed source needs no cancel callback, but still releases its lock.
        expect(cancelled).toBe(false);
      } finally {
        fetch.mockRestore();
      }
    });

    test('accepts fragmented UTF-8 and an unterminated final event', async () => {
      const first = {
        t: 'fail',
        code: 'BAD_REQUEST',
        message: 'é',
        extra: true,
        seq: 1,
      } as const;
      const bytes = new TextEncoder().encode(
        `${JSON.stringify(first)}\n${JSON.stringify(completed)}`,
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      });
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(body),
      );
      const seen: RunnerdExecEvent[] = [];
      try {
        await consume((event) => seen.push(event));
        expect(seen).toEqual([first, completed]);
        expect(body.locked).toBe(false);
      } finally {
        fetch.mockRestore();
      }
    });

    test('refuses invalid UTF-8 at the end instead of silently replacing bytes', async () => {
      const prefix = new TextEncoder().encode(
        '{"t":"fail","code":"BAD_REQUEST","message":"',
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(prefix);
          controller.enqueue(new Uint8Array([0xc3]));
          controller.close();
        },
      });
      const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(body),
      );
      const seen: RunnerdExecEvent[] = [];
      try {
        await rejects(
          consume((event) => seen.push(event)),
          /runnerd protocol: invalid UTF-8/,
        );
        expect(seen).toEqual([]);
        expect(body.locked).toBe(false);
      } finally {
        fetch.mockRestore();
      }
    });
  });
}

const opts = { baseUrl: 'http://runnerd.test', token: '' };
const encoder = new TextEncoder();

afterEach(() => {
  mock.restore();
});

function respond(body: ReadableStream<Uint8Array>): void {
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected the runnerd stream to fail');
}

const readers = {
  exec: (onEvent: (event: RunnerdExecEvent) => void | Promise<void>) =>
    runnerdExec(
      opts,
      {
        execId: 'exec-test',
        command: ['true'],
        timeoutMs: 1000,
        stdoutMaxBytes: 1024,
        stderrMaxBytes: 1024,
      },
      onEvent,
    ),
  attach: (onEvent: (event: RunnerdExecEvent) => void | Promise<void>) =>
    runnerdAttach(opts, 'exec-test', onEvent),
};

describe('runnerd response reader ownership', () => {
  test('repeated failed HTTP attachments stop each upstream producer before reconnecting', async () => {
    let active = 0;
    const stopped: PromiseWithResolvers<void>[] = [];
    const timers = new Set<ReturnType<typeof setInterval>>();
    const oversized = new Uint8Array(1_048_577).fill(120);
    const continued = encoder.encode('still-producing');
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        const detached = Promise.withResolvers<void>();
        stopped.push(detached);
        let timer: ReturnType<typeof setInterval> | undefined;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              active++;
              controller.enqueue(oversized);
              timer = setInterval(() => controller.enqueue(continued), 10);
              timers.add(timer);
            },
            cancel() {
              if (timer !== undefined) {
                clearInterval(timer);
                timers.delete(timer);
              }
              active--;
              detached.resolve();
            },
          }),
          { headers: { 'content-type': 'application/x-ndjson' } },
        );
      },
    });
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const error = await rejection(
          runnerdAttach(
            { baseUrl: server.url.origin, token: '' },
            'exec-test',
            () => {},
          ),
        );
        expect(error.message).toContain(
          'runnerd protocol: NDJSON record exceeded',
        );
        const detached = stopped[attempt];
        expect(detached).toBeDefined();
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          // fetch cancellation reaches the remote producer asynchronously.
          // Never start a replacement while the old subscription still runs.
          const closed = await Promise.race([
            detached?.promise.then(() => true),
            new Promise<false>((resolve) => {
              deadline = setTimeout(() => resolve(false), 1000);
            }),
          ]);
          expect(closed).toBe(true);
          expect(active).toBe(0);
          expect(timers.size).toBe(0);
        } finally {
          clearTimeout(deadline);
        }
      }
      expect(stopped).toHaveLength(8);
    } finally {
      for (const timer of timers) clearInterval(timer);
      await server.stop(true);
    }
  });

  test.each(Object.entries(readers))(
    '%s cancels every rejected stream before a reconnect',
    async (_name, consume) => {
      let active = 0;
      const bodies: ReadableStream<Uint8Array>[] = [];
      for (let attempt = 0; attempt < 8; attempt++) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            active++;
            controller.enqueue(new Uint8Array(1_048_577).fill(120));
          },
          cancel() {
            active--;
          },
        });
        bodies.push(body);
        respond(body);
        const error = await rejection(consume(() => {}));
        expect(error.message).toContain(
          'runnerd protocol: NDJSON record exceeded',
        );
      }
      expect(active).toBe(0);
      expect(bodies.every((body) => !body.locked)).toBe(true);
    },
  );

  test('releases a completed stream and preserves split records and a final unterminated event', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"t":"sta'));
        controller.enqueue(
          encoder.encode(
            'rt","execId":"exec-test","startedAtMs":1,"seq":1}\n{"t":"stdout","b64":"b2s=","seq":2}',
          ),
        );
        controller.close();
      },
    });
    const events: RunnerdExecEvent[] = [];
    respond(body);
    await runnerdAttach(opts, 'exec-test', (event) => {
      events.push(event);
    });
    expect(events).toEqual([
      { t: 'start', execId: 'exec-test', startedAtMs: 1, seq: 1 },
      { t: 'stdout', b64: 'b2s=', seq: 2 },
    ]);
    expect(body.locked).toBe(false);
  });

  test('malformed history stops delivery and cancels its producer before any later terminal event', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            '{"t":"start","execId":"exec-test","startedAtMs":1,"seq":1}\nnot-json\n{"t":"exit","exitCode":0,"seq":2}\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const events: RunnerdExecEvent[] = [];
    respond(body);
    expect(
      await rejection(
        runnerdAttach(opts, 'exec-test', (event) => {
          events.push(event);
        }),
      ),
    ).toBeInstanceOf(RunnerdProtocolError);
    expect(events).toEqual([
      { t: 'start', execId: 'exec-test', startedAtMs: 1, seq: 1 },
    ]);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  test('releases a failed transport without replacing its error', async () => {
    const failure = new Error('runnerd connection reset');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    respond(body);
    expect(await rejection(runnerdAttach(opts, 'exec-test', () => {}))).toBe(
      failure,
    );
    expect(body.locked).toBe(false);
  });

  test.each([false, true])(
    'cancels an open stream on consumer failure, preserving the error when cancellation rejects=%s',
    async (cancelRejects) => {
      const failure = new Error('SSE output consumer failed');
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('{"t":"stdout","b64":"b2s=","seq":1}\n'),
          );
        },
        cancel() {
          cancelled = true;
          if (cancelRejects) throw new Error('connection already closed');
        },
      });
      respond(body);
      expect(
        await rejection(
          runnerdAttach(opts, 'exec-test', () => {
            throw failure;
          }),
        ),
      ).toBe(failure);
      expect(cancelled).toBe(true);
      expect(body.locked).toBe(false);
    },
  );
  test.each(Object.entries(readers))(
    '%s releases a rejected consumer and aborts fetch before upstream cancellation acknowledges',
    async (_name, consume) => {
      const failure = new Error('SSE output consumer rejected');
      const cancelling = Promise.withResolvers<void>();
      const acknowledge = Promise.withResolvers<void>();
      let observed: unknown;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('{"t":"stdout","b64":"b2s=","seq":1}\n'),
          );
        },
        cancel() {
          cancelling.resolve();
          return acknowledge.promise;
        },
      });
      const fetching = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(body),
      );
      const settled = consume(async () => {
        throw failure;
      }).catch((error: unknown) => {
        observed = error;
      });
      try {
        await cancelling.promise;
        // Give the rejected consumer and its outer finally a turn to finish;
        // the upstream acknowledgement deliberately remains unresolved.
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(observed).toBe(failure);
        const signal = fetching.mock.calls[0]?.[1]?.signal;
        expect(signal?.aborted).toBe(true);
        expect(body.locked).toBe(false);
      } finally {
        acknowledge.resolve();
        await settled;
      }
    },
  );
});

test('file reads expose the first bytes before the upstream file finishes', async () => {
  const finish = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
            await finish.promise;
            controller.enqueue(new TextEncoder().encode('last'));
            controller.close();
          },
        }),
      );
    },
  });
  try {
    const response = await runnerdReadFile(
      { baseUrl: server.url.origin, token: 'test' },
      'large.bin',
    );
    expect(response).not.toBeNull();
    const reader = response!.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    finish.resolve();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('last');
    expect((await reader.read()).done).toBe(true);
  } finally {
    finish.resolve();
    await server.stop(true);
  }
});

test('cancelling a file consumer detaches the upstream body', async () => {
  const cancelled = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelled.resolve();
          },
        }),
      );
    },
  });
  try {
    const abort = new AbortController();
    const response = await runnerdReadFile(
      { baseUrl: server.url.origin, token: 'test' },
      'large.bin',
      abort.signal,
    );
    const reader = response!.body!.getReader();
    await reader.read();
    abort.abort();
    expect(await reader.read().catch((error: unknown) => error)).toBeInstanceOf(
      Error,
    );
    await cancelled.promise;
  } finally {
    await server.stop(true);
  }
});

test('staging preserves reconciliation and reports admission refusals distinctly', async () => {
  const bodies: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      bodies.push(await request.json());
      return Response.json({ error: 'busy' }, { status: 503 });
    },
  });
  try {
    const failure = await runnerdStageFiles(
      { baseUrl: server.url.origin, token: 'test' },
      [{ path: 'inputs/a', sourceId: 'source-a' }],
      { replaceRoots: ['inputs'], keepPaths: ['inputs/a'] },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunnerdStageBusyError);
    expect(bodies).toEqual([
      {
        files: [{ path: 'inputs/a', sourceId: 'source-a' }],
        replaceRoots: ['inputs'],
        keepPaths: ['inputs/a'],
      },
    ]);
  } finally {
    await server.stop(true);
  }
});

test('a cancelled staging caller detaches the daemon request promptly', async () => {
  const arrived = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch() {
      arrived.resolve();
      return new Promise<Response>(() => {});
    },
  });
  const abort = new AbortController();
  try {
    const result = runnerdStageFiles(
      { baseUrl: server.url.origin, token: 'test' },
      [{ path: 'a', contentBase64: 'YQ==' }],
      {},
      { signal: abort.signal, timeoutMs: 1000 },
    ).catch((error: unknown) => error);
    await arrived.promise;
    abort.abort();
    expect(
      await Promise.race([result, Bun.sleep(200).then(() => 'still pending')]),
    ).toBeInstanceOf(Error);
  } finally {
    abort.abort();
    await server.stop(true);
  }
});

test('staging timeout bounds an unresponsive daemon without a caller signal', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  try {
    const failure = await runnerdStageFiles(
      { baseUrl: server.url.origin, token: 'test' },
      [],
      {},
      { timeoutMs: 20 },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ name: 'TimeoutError' });
  } finally {
    await server.stop(true);
  }
});

test('session creation cancellation reaches the environment patch request', async () => {
  const arrived = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch() {
      arrived.resolve();
      return new Promise<Response>(() => {});
    },
  });
  const abort = new AbortController();
  try {
    const result = runnerdEnvPatch(
      { baseUrl: server.url.origin, token: 'test' },
      { set: { TEST: 'value' } },
      abort.signal,
    ).catch((error: unknown) => error);
    await arrived.promise;
    abort.abort();
    expect(
      await Promise.race([result, Bun.sleep(200).then(() => 'still pending')]),
    ).toBeInstanceOf(Error);
  } finally {
    abort.abort();
    await server.stop(true);
  }
});

const bodies = new Map<string, string>();
const server = Bun.serve({
  port: 0,
  fetch(req) {
    return new Response(bodies.get(new URL(req.url).pathname) ?? '', {
      headers: { 'content-type': 'application/x-ndjson' },
    });
  },
});
afterAll(() => server.stop(true));
const options = {
  baseUrl: server.url.toString().replace(/\/$/, ''),
  token: 'test-only',
};
function setReplayBody(id: string, events: unknown[]): void {
  bodies.set(
    `/execs/${id}/attach`,
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}

describe('runnerd replay continuity', () => {
  test('a checkpoint-recoverable gap preserves its exact range for the consumer', async () => {
    const gap: RunnerdExecEvent = { t: 'gap', fromSeq: 4, toSeq: 9 };
    setReplayBody('checkpoint-gap', [{ t: 'replay-start' }, gap]);
    const seen: RunnerdExecEvent[] = [];
    expect(
      await runnerdAttach(
        options,
        'checkpoint-gap',
        (event) => {
          seen.push(event);
        },
        undefined,
        3,
      ),
    ).toBe(true);
    expect(seen).toEqual([{ t: 'replay-start' }, gap]);
  });

  test('older ring-only runtime cannot silently replay a truncated tail as successful', async () => {
    setReplayBody('legacy-gap', [
      { t: 'stdout', b64: 'eA==', seq: 30 },
      { t: 'exit', seq: 31, exitCode: 0 },
    ]);
    const seen: RunnerdExecEvent[] = [];
    expect(
      await runnerdAttach(options, 'legacy-gap', (event) => {
        seen.push(event);
      }).catch((error: unknown) => error),
    ).toBeInstanceOf(RunnerdOutputGapError);
    expect(seen).toEqual([]);
  });
  test('a reported checkpoint gap cannot be followed by a successful result', async () => {
    const gap: RunnerdExecEvent = { t: 'gap', fromSeq: 1, toSeq: 9 };
    setReplayBody('gap-then-result', [gap, { ...completed, seq: 1 }]);
    const seen: RunnerdExecEvent[] = [];
    expect(
      await runnerdAttach(options, 'gap-then-result', (event) => {
        seen.push(event);
      }).catch((error: unknown) => error),
    ).toBeInstanceOf(RunnerdOutputGapError);
    expect(seen).toEqual([gap]);
  });
  test('a cursor reconnect accepts exactly the next sequence', async () => {
    setReplayBody('cursor', [{ t: 'stdout', b64: 'eA==', seq: 30 }]);
    const seen: RunnerdExecEvent[] = [];
    expect(
      await runnerdAttach(
        options,
        'cursor',
        (event) => {
          seen.push(event);
        },
        undefined,
        29,
      ),
    ).toBe(true);
    expect(seen).toHaveLength(1);
  });
  test.each([
    'OUTPUT_GAP',
    'OUTPUT_LIMIT',
    'REPLAY_UNAVAILABLE',
    'REPLAY_DISK_FULL',
  ])(
    'daemon replay failure %s retains its terminal diagnostic code',
    async (code) => {
      setReplayBody('journal-gap', [
        { t: 'fail', code, message: 'bounded replay exhausted' },
      ]);
      expect(
        await runnerdAttach(options, 'journal-gap', () => {}).catch(
          (error: unknown) => error,
        ),
      ).toMatchObject({ code });
    },
  );
  test('a gap in the middle stops delivery before a later terminal result', async () => {
    setReplayBody('middle', [
      { t: 'stdout', b64: 'eA==', seq: 3 },
      { ...completed, seq: 5 },
    ]);
    const seen: RunnerdExecEvent[] = [];
    expect(
      await runnerdAttach(
        options,
        'middle',
        (event) => {
          seen.push(event);
        },
        undefined,
        2,
      ).catch((error: unknown) => error),
    ).toBeInstanceOf(RunnerdOutputGapError);
    expect(seen.map((event) => event.seq)).toEqual([3]);
  });
});

test('an unsequenced output cannot silently bypass replay continuity', async () => {
  setReplayBody('missing-sequence', [
    { t: 'stdout', b64: 'eA==' },
    { t: 'exit', seq: 1, exitCode: 0 },
  ]);
  const seen: RunnerdExecEvent[] = [];
  expect(
    await runnerdAttach(options, 'missing-sequence', (event) => {
      seen.push(event);
    }).catch((error: unknown) => error),
  ).toBeInstanceOf(RunnerdOutputGapError);
  expect(seen).toEqual([]);
});

test('replay delivery awaits downstream consumers before parsing later events', async () => {
  setReplayBody('backpressure', [
    { t: 'stdout', b64: 'eA==', seq: 1 },
    { t: 'stdout', b64: 'eQ==', seq: 2 },
  ]);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const seen: number[] = [];
  const pumping = runnerdAttach(options, 'backpressure', async (event) => {
    seen.push(event.seq ?? 0);
    if (event.seq === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  try {
    await entered.promise;
    expect(seen).toEqual([1]);
  } finally {
    release.resolve();
  }
  await pumping;
  expect(seen).toEqual([1, 2]);
});

describe('session incarnation', () => {
  test('an activity request names the incarnation it is meant for', async () => {
    const named: Array<string | null> = [];
    const daemon = Bun.serve({
      port: 0,
      fetch(request) {
        named.push(request.headers.get('x-tale-runnerd-incarnation'));
        return Response.json({ generation: 'g1', incarnation: '1700' });
      },
    });
    try {
      const target = { baseUrl: daemon.url.origin, token: 'test' };
      expect(
        await runnerdActivity({ ...target, incarnation: 1700 }, 'acquire'),
      ).toEqual({ generation: 'g1', incarnation: '1700' });
      await runnerdActivity(target, 'ticket');
      expect(named).toEqual(['1700', null]);
    } finally {
      await daemon.stop(true);
    }
  });

  test('a refusal by another incarnation names the one that answered', async () => {
    const answers = [
      Response.json(
        { error: 'incarnation_mismatch', incarnation: '1800' },
        { status: 409 },
      ),
      Response.json({ error: 'conflict' }, { status: 409 }),
      new Response('not json', { status: 409 }),
      Response.json({ error: 'reclaiming' }, { status: 503 }),
    ];
    const daemon = Bun.serve({
      port: 0,
      fetch: () => answers.shift() ?? new Response(null, { status: 500 }),
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const target = {
        baseUrl: daemon.url.origin,
        token: 'test',
        incarnation: 1700,
      };
      const failures: unknown[] = [];
      for (let i = 0; i < 4; i += 1)
        failures.push(
          await runnerdActivity(target, 'release', { generation: 'g1' }).catch(
            (error: unknown) => error,
          ),
        );
      expect(failures.every((f) => f instanceof RunnerdActivityError)).toBe(
        true,
      );
      expect(failures).toMatchObject([
        { status: 409, incarnation: '1800' },
        { status: 409, incarnation: undefined },
        { status: 409, incarnation: undefined },
        { status: 503, incarnation: undefined },
      ]);
    } finally {
      warn.mockRestore();
      await daemon.stop(true);
    }
  });

  test.each([
    ['1700', 'registered'],
    ['1800', 'replaced'],
    [undefined, 'unnamed'],
    ['', 'unnamed'],
    [1700, 'unnamed'],
    ['17e2', 'unnamed'],
    ['12345678901234567', 'unnamed'],
  ] as const)('an answer naming %p is %s', (named, expected) => {
    expect(answeringIncarnation(1700, named)).toBe(expected);
  });
});

describe('runnerd exec admission', () => {
  const request = {
    execId: 'exec-memory',
    command: ['true'],
    timeoutMs: 1000,
    stdoutMaxBytes: 0,
    stderrMaxBytes: 0,
  };

  test('a session short of memory refuses the exec before it starts, with its wait', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: 'session_memory_busy',
          code: 'SESSION_MEMORY_BUSY',
          message: 'the session is using 90% or more of its memory limit',
        },
        { status: 429, headers: { 'retry-after': '7' } },
      ),
    );
    try {
      const error = await runnerdOpenExec(opts, request).then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(RunnerdMemoryBusyError);
      expect(error).toMatchObject({
        message: 'the session is using 90% or more of its memory limit',
        retryAfterMs: 7_000,
      });
    } finally {
      fetch.mockRestore();
    }
  });

  test('any other refusal stays an ordinary failure', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'busy' }, { status: 429 }),
    );
    try {
      const error = await runnerdOpenExec(opts, request).then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(error).not.toBeInstanceOf(RunnerdMemoryBusyError);
      expect(String(error)).toContain('runnerd /execs 429');
    } finally {
      fetch.mockRestore();
    }
  });

  test('an accepted exec streams its events once pumped', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`${JSON.stringify({ ...completed, seq: 1 })}\n`),
    );
    try {
      const stream = await runnerdOpenExec(opts, request);
      const events: RunnerdExecEvent[] = [];
      await stream.pump((event) => {
        events.push(event);
      });
      stream.close();
      expect(events.map((event) => event.t)).toEqual(['exit']);
    } finally {
      fetch.mockRestore();
    }
  });
});
