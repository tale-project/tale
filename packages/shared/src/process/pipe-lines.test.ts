import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

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
});
