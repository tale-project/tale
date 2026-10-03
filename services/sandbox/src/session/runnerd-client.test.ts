import { expect, test } from 'bun:test';

import {
  runnerdReadFile,
  runnerdStageFiles,
  RunnerdStageBusyError,
  runnerdEnvPatch,
} from './runnerd-client.ts';

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
