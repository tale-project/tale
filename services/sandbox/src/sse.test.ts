import { describe, expect, spyOn, test } from 'bun:test';

import { RUNNERD_CONSUMER_BUFFER_MAX_BYTES } from './session/runnerd-protocol.ts';
import { sseResponse } from './sse.ts';

describe('sandbox SSE lifecycle and memory', () => {
  test('frames events and keeps the required streaming headers', async () => {
    const response = sseResponse(
      async ({ send }) => {
        send('phase', { phase: 'running' });
        send('stdout', { text: 'hello\nworld' });
      },
      { 'x-test': 'kept', 'content-type': 'text/plain' },
    );
    expect(response.headers.get('x-test')).toBe('kept');
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe(
      'event: phase\ndata: {"phase":"running"}\n\nevent: stdout\ndata: {"text":"hello\\nworld"}\n\n',
    );
  });

  test('cancels immediately while the producer is pending, clears its timer and ignores late output', async () => {
    const producer = Promise.withResolvers<void>();
    const clearTimer = spyOn(globalThis, 'clearInterval');
    const warn = spyOn(console, 'warn');
    let sendLate: ((event: string, data: unknown) => void) | undefined;
    let producerSignal: AbortSignal | undefined;
    const response = sseResponse(async ({ send, signal }) => {
      sendLate = send;
      producerSignal = signal;
      await producer.promise;
    });
    try {
      const result = await Promise.race([
        response.body?.cancel().then(() => 'cancelled'),
        Bun.sleep(1000).then(() => 'still waiting'),
      ]);
      expect(result).toBe('cancelled');
      expect(producerSignal?.aborted).toBe(true);
      expect(clearTimer).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 1000; i++) {
        sendLate?.('stdout', {
          toJSON() {
            throw new Error('late serialization');
          },
        });
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      producer.resolve();
      clearTimer.mockRestore();
      warn.mockRestore();
    }
  });

  test('bounds a stalled consumer by bytes and stops before serializing another event', async () => {
    let producerSignal: AbortSignal | undefined;
    // Two events exceed the byte ceiling while using fewer UTF-16 units.
    const text = '€'.repeat(Math.ceil(RUNNERD_CONSUMER_BUFFER_MAX_BYTES / 6));
    let extraSerialized = false;
    const response = sseResponse(async ({ send, signal }) => {
      producerSignal = signal;
      send('stdout', { text });
      send('stdout', { text });
      send('stdout', {
        toJSON() {
          extraSerialized = true;
          return 'late';
        },
      });
    });
    expect(producerSignal?.aborted).toBe(true);
    expect(extraSerialized).toBe(false);
    const failure = await response.text().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: 'SSE consumer exceeded its buffered output limit',
    });
  });

  test('preserves a single terminal result larger than the queue ceiling', async () => {
    const body = 'x'.repeat(14 * 1024 * 1024);
    let producerSignal: AbortSignal | undefined;
    const response = sseResponse(async ({ send, signal }) => {
      producerSignal = signal;
      send('result', { stdoutBase64: body });
    });
    expect(await response.text()).toBe(
      `event: result\ndata: {"stdoutBase64":"${body}"}\n\n`,
    );
    expect(producerSignal?.aborted).toBe(false);
  });

  test('a draining consumer can keep reading beyond the total byte ceiling', async () => {
    const producer = Promise.withResolvers<void>();
    let sendMore: ((event: string, data: unknown) => void) | undefined;
    let producerSignal: AbortSignal | undefined;
    const response = sseResponse(async ({ send, signal }) => {
      sendMore = send;
      producerSignal = signal;
      await producer.promise;
    });
    const reader = response.body?.getReader();
    try {
      const text = 'x'.repeat(RUNNERD_CONSUMER_BUFFER_MAX_BYTES / 2);
      for (let i = 0; i < 4; i++) {
        sendMore?.('stdout', { text });
        expect((await reader?.read())?.done).toBe(false);
      }
      expect(producerSignal?.aborted).toBe(false);
      producer.resolve();
      expect((await reader?.read())?.done).toBe(true);
    } finally {
      producer.resolve();
      reader?.releaseLock();
    }
  });

  test('producer rejection fails the stream and clears its timer', async () => {
    const clearTimer = spyOn(globalThis, 'clearInterval');
    const failure = new Error('producer failed');
    const response = sseResponse(async () => {
      throw failure;
    });
    try {
      expect(await response.text().catch((error: unknown) => error)).toBe(
        failure,
      );
      expect(clearTimer).toHaveBeenCalledTimes(1);
    } finally {
      clearTimer.mockRestore();
    }
  });

  test('a synchronous producer throw also fails the stream cleanly', async () => {
    const failure = new Error('producer failed before returning');
    const response = sseResponse(() => {
      throw failure;
    });
    expect(await response.text().catch((error: unknown) => error)).toBe(
      failure,
    );
  });
});
