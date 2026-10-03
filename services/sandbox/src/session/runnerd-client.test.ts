import { expect, test } from 'bun:test';

import { runnerdReadFile } from './runnerd-client.ts';

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
