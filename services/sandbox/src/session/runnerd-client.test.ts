import { afterAll, describe, expect, test } from 'bun:test';

import {
  runnerdReadFile,
  runnerdAttach,
  RunnerdOutputGapError,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';

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
function body(id: string, events: unknown[]): void {
  bodies.set(
    `/execs/${id}/attach`,
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}

describe('runnerd replay continuity', () => {
  test('older ring-only runtime cannot silently replay a truncated tail as successful', async () => {
    body('legacy-gap', [
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
  test('a cursor reconnect accepts exactly the next sequence', async () => {
    body('cursor', [{ t: 'stdout', b64: 'eA==', seq: 30 }]);
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
  test('new runtime journal exhaustion is terminal, not a generic transport retry', async () => {
    body('journal-gap', [
      { t: 'fail', code: 'OUTPUT_GAP', message: 'bounded journal exhausted' },
    ]);
    expect(
      await runnerdAttach(options, 'journal-gap', () => {}).catch(
        (error: unknown) => error,
      ),
    ).toBeInstanceOf(RunnerdOutputGapError);
  });
  test('a gap in the middle stops delivery before a later terminal result', async () => {
    body('middle', [
      { t: 'stdout', b64: 'eA==', seq: 3 },
      { t: 'exit', seq: 5, exitCode: 0 },
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
  body('missing-sequence', [
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
  body('backpressure', [
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
