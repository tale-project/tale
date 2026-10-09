// @vitest-environment node

/**
 * The per-stream writer's backlog ceiling must tell a stalled client from a
 * big delivery: a replay of hundreds of hints is one write, and a write onto
 * an empty backlog is always taken.
 */

import type { SSEStreamingApi } from 'hono/streaming';
import { describe, expect, it } from 'vitest';

import { createStreamWriter, type FanoutStream } from './sse-fanout.ts';

function stalledStream(): {
  target: FanoutStream;
  written: string[];
  release: () => void;
} {
  const written: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = {
    aborted: false,
    async write(text: string) {
      await gate;
      written.push(text);
      return stream;
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the writer only calls write and reads aborted
    target: {
      stream: stream as unknown as SSEStreamingApi,
      lastWriteAt: 0,
      ended: false,
    },
    written,
    release: () => release(),
  };
}

describe('createStreamWriter', () => {
  it('takes one big batch onto an empty backlog', async () => {
    const { target, written, release } = stalledStream();
    let overflowed = 0;
    const writer = createStreamWriter(target, {
      maxPendingBytes: 1024,
      onOverflow: () => {
        overflowed += 1;
      },
    });
    const batch = 'x'.repeat(4096);
    writer.write(batch);
    expect(overflowed).toBe(0);
    expect(writer.pending()).toBe(1);
    release();
    await writer.flushed();
    expect(written).toEqual([batch]);
    expect(writer.pending()).toBe(0);
  });

  it('gives up on a client that takes nothing once the backlog passes its bytes', () => {
    const { target } = stalledStream();
    let overflowed = 0;
    const writer = createStreamWriter(target, {
      maxPendingBytes: 1024,
      onOverflow: () => {
        overflowed += 1;
      },
    });
    writer.write('a'.repeat(600));
    writer.write('b'.repeat(400));
    expect(overflowed).toBe(0);
    // 1,100 queued characters would pass the 1,024 budget.
    writer.write('c'.repeat(100));
    expect(overflowed).toBe(1);
    expect(writer.pending()).toBe(2);
  });

  it('gives up once the backlog passes its write count', () => {
    const { target } = stalledStream();
    let overflowed = 0;
    const writer = createStreamWriter(target, {
      maxPendingWrites: 3,
      onOverflow: () => {
        overflowed += 1;
      },
    });
    for (let i = 0; i < 3; i += 1) writer.write('hint\n\n');
    expect(overflowed).toBe(0);
    writer.write('hint\n\n');
    expect(overflowed).toBe(1);
  });

  it('takes more once the client drains', async () => {
    const { target, written, release } = stalledStream();
    let overflowed = 0;
    const writer = createStreamWriter(target, {
      maxPendingBytes: 10,
      onOverflow: () => {
        overflowed += 1;
      },
    });
    writer.write('12345678');
    release();
    await writer.flushed();
    writer.write('12345678');
    await writer.flushed();
    expect(overflowed).toBe(0);
    expect(written).toEqual(['12345678', '12345678']);
  });
});
