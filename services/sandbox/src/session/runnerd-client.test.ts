import { describe, expect, spyOn, test } from 'bun:test';
import { rejects } from 'node:assert/strict';

import {
  runnerdAttach,
  runnerdExec,
  runnerdReadFile,
  waitForRunnerd,
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
            new TextEncoder().encode(`${JSON.stringify(completed)}\n`),
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
