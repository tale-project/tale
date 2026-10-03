import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { pipeLines, pipeNodeStream } from './pipe-lines.ts';

/** A web ReadableStream that emits the given chunks (strings encoded as UTF-8). */
function webStream(
  chunks: Array<string | Uint8Array>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      }
      controller.close();
    },
  });
}

async function collect(
  chunks: Array<string | Uint8Array>,
  maxChars?: number,
): Promise<string[]> {
  const out: string[] = [];
  await pipeLines(webStream(chunks), (l) => out.push(l), maxChars);
  return out;
}

describe('pipeLines (web ReadableStream)', () => {
  it('reassembles a line split across chunks', async () => {
    expect(await collect(['hel', 'lo\nwor', 'ld\n'])).toEqual([
      'hello',
      'world',
    ]);
  });

  it('strips a trailing CR (CRLF)', async () => {
    expect(await collect(['a\r\nb\r\n'])).toEqual(['a', 'b']);
  });

  it('flushes a final unterminated line', async () => {
    expect(await collect(['a\nb'])).toEqual(['a', 'b']);
  });

  it('passes empty lines through (blank line inside content)', async () => {
    expect(await collect(['a\n\nb\n'])).toEqual(['a', '', 'b']);
  });

  it('delivers a CRLF blank line as an empty line, like an LF one', async () => {
    expect(await collect(['a\r\n\r\nb'])).toEqual(['a', '', 'b']);
  });

  it('does not emit a spurious trailing blank after the last newline', async () => {
    expect(await collect(['x\n'])).toEqual(['x']);
  });

  it('reassembles a UTF-8 multibyte char split across two chunks', async () => {
    // 你 = E4 BD A0; split the bytes across two reads, then a newline.
    const a = new Uint8Array([0xe4, 0xbd]);
    const b = new Uint8Array([0xa0, 0x0a]);
    expect(await collect([a, b])).toEqual(['你']);
  });

  it('caps a long line on a code-point boundary (no lone surrogate)', async () => {
    const out = await collect(['\u{1f680}\u{1f680}\u{1f680}\u{1f680}\n'], 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('\u{1f680}\u{1f680} …[truncated]');
  });

  it('caps plain text and marks it truncated', async () => {
    expect(await collect(['abcdef\n'], 3)).toEqual(['abc …[truncated]']);
  });

  it('passes a line past the default cap whole when uncapped', async () => {
    const long = 'x'.repeat(10_000);
    // Longer than the default cap, which would truncate it.
    expect((await collect([`${long}\n`]))[0]).toMatch(/ …\[truncated\]$/);
    expect(await collect([`${long}\n`], Number.POSITIVE_INFINITY)).toEqual([
      long,
    ]);
  });

  it('drains a huge unterminated line with bounded capture and resumes after newline', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(4096));
    let remaining = 1024;
    const out: string[] = [];
    await pipeLines(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (remaining-- > 0) controller.enqueue(chunk);
          else {
            controller.enqueue(new TextEncoder().encode('\nnext\n\n'));
            controller.close();
          }
        },
      }),
      (line) => out.push(line),
    );
    expect(out).toEqual(['x'.repeat(8192) + ' …[truncated]', 'next', '']);
  });

  it('keeps exact-cap astral text and strips a CR split into the next chunk', async () => {
    expect(await collect(['🚀🚀', '\r', '\n'], 2)).toEqual(['🚀🚀']);
    expect(await collect(['🚀🚀', '🚀', '\r', '\n'], 2)).toEqual([
      '🚀🚀 …[truncated]',
    ]);
  });

  it('flushes a decoder tail and releases its reader after EOF', async () => {
    const stream = webStream([new Uint8Array([0xe4, 0xbd])]);
    const out: string[] = [];
    await pipeLines(stream, (line) => out.push(line));
    expect(out).toEqual(['�']);
    expect(stream.locked).toBe(false);
  });

  it('cancels the source and releases its reader when the consumer throws', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('line\n'));
      },
      cancel,
    });
    const error = new Error('consumer failed');
    await expect(
      pipeLines(stream, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('rejects and releases its reader without waiting for source cancellation', async () => {
    const cancellation = Promise.withResolvers<void>();
    const cancel = vi.fn(() => cancellation.promise);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('line\n'));
      },
      cancel,
    });
    const error = new Error('consumer failed');
    const outcome = pipeLines(stream, () => {
      throw error;
    }).catch((reason: unknown) => reason);
    try {
      // A source may acknowledge cancellation much later (or never). Error
      // delivery and reader release must finish by the next event-loop turn.
      const nextTurn = new Promise<undefined>((resolve) =>
        setImmediate(() => resolve(undefined)),
      );
      expect(await Promise.race([outcome, nextTurn])).toBe(error);
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
    } finally {
      cancellation.resolve();
      await outcome;
    }
  });

  it('preserves a short Unicode tail captured from an oversized chunk', async () => {
    const first = `${'x'.repeat(1024 * 1024)}\n🚀${'y'.repeat(20)}`;
    expect(await collect([first, '\r', '\nnext'], 32)).toEqual([
      'x'.repeat(32) + ' …[truncated]',
      '🚀' + 'y'.repeat(20),
      'next',
    ]);
  });

  it('releases its reader when the source fails', async () => {
    const error = new Error('source failed');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error);
      },
    });
    await expect(pipeLines(stream, () => {})).rejects.toBe(error);
    expect(stream.locked).toBe(false);
  });
});

describe('pipeNodeStream (node Readable)', () => {
  it('splits a node stream into lines and flushes the tail', async () => {
    const s = new PassThrough();
    const lines: string[] = [];
    const done = pipeNodeStream(s, (l) => lines.push(l));
    s.write('a\nb');
    s.end();
    await done;
    expect(lines).toEqual(['a', 'b']);
  });

  it('passes empty lines through', async () => {
    const s = new PassThrough();
    const lines: string[] = [];
    const done = pipeNodeStream(s, (l) => lines.push(l));
    s.write('a\n\nb\n');
    s.end();
    await done;
    expect(lines).toEqual(['a', '', 'b']);
  });

  it('flushes the final line exactly once even though end and close both fire', async () => {
    const s = new PassThrough();
    const lines: string[] = [];
    const done = pipeNodeStream(s, (l) => lines.push(l));
    s.write('only');
    s.end();
    await done;
    expect(lines).toEqual(['only']); // not ['only', 'only']
  });

  it('drains a huge unterminated line and releases every owned listener on end', async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    const done = pipeNodeStream(stream, (line) => lines.push(line), 16);
    for (let i = 0; i < 1024; i++) stream.write('x'.repeat(4096));
    stream.end('\nnext');
    await done;
    expect(lines).toEqual(['x'.repeat(16) + ' …[truncated]', 'next']);
    for (const event of ['data', 'end', 'close', 'error']) {
      expect(stream.listenerCount(event)).toBe(0);
    }
  });

  it('rejects and releases every owned listener after a source error', async () => {
    const stream = new PassThrough();
    const done = pipeNodeStream(stream, () => {});
    const error = new Error('source failed');
    stream.destroy(error);
    await expect(done).rejects.toBe(error);
    for (const event of ['data', 'end', 'close', 'error']) {
      expect(stream.listenerCount(event)).toBe(0);
    }
  });

  it.each(['line\n', 'tail'])(
    'rejects instead of throwing from a consumer of %s',
    async (text) => {
      const stream = new PassThrough();
      const error = new Error('consumer failed');
      const done = pipeNodeStream(stream, () => {
        throw error;
      });
      stream.end(text);
      await expect(done).rejects.toBe(error);
      for (const event of ['data', 'end', 'close', 'error']) {
        expect(stream.listenerCount(event)).toBe(0);
      }
    },
  );
});
