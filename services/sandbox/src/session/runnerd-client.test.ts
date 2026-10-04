import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import {
  runnerdAttach,
  runnerdExec,
  runnerdReadFile,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';

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
  exec: (onEvent: (event: RunnerdExecEvent) => void) =>
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
  attach: (onEvent: (event: RunnerdExecEvent) => void) =>
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
        expect(error.message).toContain('runnerd NDJSON exceeded');
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
        expect(error.message).toContain('runnerd NDJSON exceeded');
      }
      expect(active).toBe(0);
      expect(bodies.every((body) => !body.locked)).toBe(true);
    },
  );

  test('releases a completed stream and preserves event order and malformed-line tolerance', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"t":"sta'));
        controller.enqueue(
          encoder.encode(
            'rt","execId":"exec-test","startedAtMs":1}\nnot-json\n{"t":"stdout","b64":"b2s="}',
          ),
        );
        controller.close();
      },
    });
    const warning = spyOn(console, 'warn').mockImplementation(() => {});
    const events: RunnerdExecEvent[] = [];
    try {
      respond(body);
      await runnerdAttach(opts, 'exec-test', (event) => events.push(event));
      expect(events).toEqual([
        { t: 'start', execId: 'exec-test', startedAtMs: 1 },
        { t: 'stdout', b64: 'b2s=' },
      ]);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally {
      warning.mockRestore();
    }
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
          controller.enqueue(encoder.encode('{"t":"stdout","b64":"b2s="}\n'));
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
