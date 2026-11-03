import net from 'node:net';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTcpServer } from '../../testing/local-proxies.ts';
import {
  HEAD_LIMIT,
  HeadError,
  endToEnd,
  headBytes,
  headerValue,
  hostAndPort,
  parseHeaders,
  parseStatusLine,
  readHead,
  splitHead,
} from './http-head.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** What a paused stream gives once it is resumed, up to its end. */
async function drain(stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('latin1');
}

describe('readHead', () => {
  it('reads up to the blank line and gives the rest back', async () => {
    const stream = new PassThrough();
    const head = readHead(stream);
    stream.write('GET / HTTP/1.1\r\nHost: x\r\n\r\nBODY');
    expect(await head).toBe('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    stream.end(' and more');
    expect(await drain(stream)).toBe('BODY and more');
  });

  it('finds a blank line that arrives in pieces, even split in the middle', async () => {
    const stream = new PassThrough();
    const head = readHead(stream);
    for (const piece of ['HTTP/1.1 200 OK\r', '\nA: b\r\n', '\r', '\nrest']) {
      stream.write(piece);
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(await head).toBe('HTTP/1.1 200 OK\r\nA: b\r\n\r\n');
    stream.end();
    expect(await drain(stream)).toBe('rest');
  });

  it('leaves nothing behind when the head is all there is', async () => {
    const stream = new PassThrough();
    const head = readHead(stream);
    stream.write('A\r\n\r\n');
    await head;
    stream.end();
    expect(await drain(stream)).toBe('');
  });

  it('reads one head after the other from the same stream', async () => {
    const stream = new PassThrough();
    stream.write('one\r\n\r\ntwo\r\n\r\nthree');
    expect(await readHead(stream)).toBe('one\r\n\r\n');
    expect(await readHead(stream)).toBe('two\r\n\r\n');
    stream.end();
    expect(await drain(stream)).toBe('three');
  });

  it('fails when the stream ends first', async () => {
    const stream = new PassThrough();
    const head = readHead(stream);
    stream.end('GET / HTT');
    await expect(head).rejects.toThrow(
      'connection closed before the end of the head',
    );
    await expect(head).rejects.toBeInstanceOf(HeadError);
  });

  it('fails at once on a stream that has ended or been destroyed', async () => {
    const destroyed = new PassThrough();
    destroyed.destroy();
    await expect(readHead(destroyed)).rejects.toThrow(
      'connection closed before the end of the head',
    );
  });

  it('fails with the stream error', async () => {
    const stream = new PassThrough();
    const head = readHead(stream);
    stream.destroy(new Error('boom'));
    await expect(head).rejects.toThrow('boom');
  });

  describe('with a time to read it in', () => {
    it('fails when the head is not all there by then, and stops listening', async () => {
      vi.useFakeTimers();
      try {
        const stream = new PassThrough();
        const head = readHead(stream, HEAD_LIMIT, 1000);
        const failed = head.catch((error: unknown) => error);
        stream.write('GET / HTTP/1.1\r\nHost: x\r\n'); // no blank line
        await vi.advanceTimersByTimeAsync(999);
        expect(stream.listenerCount('data')).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        const error = await failed;
        expect(error).toBeInstanceOf(HeadError);
        expect(error).toHaveProperty(
          'message',
          'the head did not arrive in time',
        );
        expect(stream.listenerCount('data')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('is not too late for a head that is there before the time is up, and leaves no timer behind', async () => {
      vi.useFakeTimers();
      try {
        const stream = new PassThrough();
        const head = readHead(stream, HEAD_LIMIT, 1000);
        await vi.advanceTimersByTimeAsync(500);
        stream.write('A\r\n\r\nrest');
        expect(await head).toBe('A\r\n\r\n');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('waits for ever without one', async () => {
      vi.useFakeTimers();
      try {
        const stream = new PassThrough();
        const head = readHead(stream);
        const state = { settled: false };
        head.catch(() => undefined).finally(() => (state.settled = true));
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(state.settled).toBe(false);
        stream.write('A\r\n\r\n');
        await head;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('refuses a head that is too large, whether or not the end of it came along', async () => {
    const endless = new PassThrough();
    const never = readHead(endless, 100);
    endless.write('x'.repeat(101));
    await expect(never).rejects.toThrow('head too large');

    const oversize = new PassThrough();
    const head = readHead(oversize, 100);
    oversize.write(`${'x'.repeat(200)}\r\n\r\n`); // the blank line is there, but too far
    await expect(head).rejects.toThrow('head too large');

    const exact = new PassThrough();
    const fits = readHead(exact, 10);
    exact.write(`${'x'.repeat(10)}\r\n\r\n`);
    expect(await fits).toBe(`${'x'.repeat(10)}\r\n\r\n`);
    expect(HEAD_LIMIT).toBe(256 * 1024);
  });

  it('works on a socket, and hands the socket on paused with the rest unshifted', async () => {
    const server = await startTcpServer((socket) => {
      socket.write('HTTP/1.1 200 OK\r\n\r\nafter');
      setTimeout(() => socket.end('-more'), 30);
    });
    cleanups.push(() => server.stop());
    const socket = net.connect({ host: '127.0.0.1', port: server.port });
    const head = await readHead(socket);
    expect(head).toBe('HTTP/1.1 200 OK\r\n\r\n');
    expect(socket.isPaused()).toBe(true);
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.resume();
    await new Promise((resolve) => socket.once('close', resolve));
    expect(Buffer.concat(chunks).toString()).toBe('after-more');
  });
});

describe('splitHead', () => {
  it('separates the start line from the header lines', () => {
    expect(splitHead('GET / HTTP/1.1\r\nA: b\r\nC: d\r\n\r\n')).toEqual({
      startLine: 'GET / HTTP/1.1',
      lines: ['A: b', 'C: d', '', ''],
    });
  });

  it('refuses a stray line break, which would let a header smuggle another one', () => {
    expect(() => splitHead('GET / HTTP/1.1\r\nA: b\rX: y\r\n\r\n')).toThrow(
      'stray line break',
    );
    expect(() => splitHead('GET / HTTP/1.1\r\nA: b\nX: y\r\n\r\n')).toThrow(
      'stray line break',
    );
  });
});

describe('parseHeaders', () => {
  it('keeps names and values, trimmed, in order, and skips what is no header', () => {
    expect(
      parseHeaders([
        'Host:  a.test ',
        'X-Empty:',
        'no colon',
        ': no name',
        '',
        'A: b: c',
      ]),
    ).toEqual([
      ['Host', 'a.test'],
      ['X-Empty', ''],
      ['A', 'b: c'],
    ]);
  });
});

describe('endToEnd', () => {
  it('drops the hop-by-hop headers and those that Connection names', () => {
    const headers = parseHeaders([
      'Host: a.test',
      'Connection: keep-alive, X-Secret',
      'Keep-Alive: timeout=5',
      'Proxy-Authorization: Basic abc',
      'Proxy-Authenticate: Basic',
      'Proxy-Connection: close, X-Other',
      'TE: trailers',
      'Trailer: X',
      'Upgrade: websocket',
      'X-Secret: 1',
      'X-Other: 2',
      'X-Kept: 3',
      'Transfer-Encoding: chunked',
    ]);
    expect(endToEnd(headers)).toEqual([
      ['Host', 'a.test'],
      ['X-Kept', '3'],
      ['Transfer-Encoding', 'chunked'],
    ]);
  });

  it('matches names case-insensitively', () => {
    expect(
      endToEnd(parseHeaders(['cOnNeCtIoN: x-y', 'X-Y: 1', 'x-z: 2'])),
    ).toEqual([['x-z', '2']]);
  });
});

describe('headerValue', () => {
  it('finds the first value of a header, whatever its case', () => {
    const headers = parseHeaders(['Content-Type: a', 'content-type: b']);
    expect(headerValue(headers, 'CONTENT-TYPE')).toBe('a');
    expect(headerValue(headers, 'Missing')).toBeUndefined();
  });
});

describe('parseStatusLine', () => {
  it.each([
    ['HTTP/1.1 200 OK', 200, 'OK'],
    [
      'HTTP/1.0 407 Proxy Authentication Required',
      407,
      'Proxy Authentication Required',
    ],
    ['HTTP/1.1 502', 502, ''],
    ['HTTP/1.1 502 ', 502, ''],
    ['HTTP/2 200 fine', 200, 'fine'],
    ['HTTP/1.1 200 Connection Established  ', 200, 'Connection Established'],
  ])('reads %j', (line, status, reason) => {
    expect(parseStatusLine(line)).toEqual({ status, reason });
  });

  it.each([
    '',
    'nonsense',
    'HTTP/1.1',
    'HTTP/1.1 20 OK',
    'HTTP/1.1 2000 OK',
    'HTTP/1.1  200 OK',
    'ICY 200 OK',
    'HTTP/1.1 abc OK',
  ])('refuses %j', (line) => {
    expect(() => parseStatusLine(line)).toThrow('not an HTTP response');
  });
});

describe('headBytes and hostAndPort', () => {
  it('writes the lines and a blank line as latin-1', () => {
    expect(headBytes(['GET / HTTP/1.1', 'X: é']).toString('latin1')).toBe(
      'GET / HTTP/1.1\r\nX: é\r\n\r\n',
    );
    expect([...headBytes(['X: é'])]).toContain(0xe9);
  });

  it('brackets an IPv6 host', () => {
    expect(hostAndPort('example.com', 443)).toBe('example.com:443');
    expect(hostAndPort('::1', 8080)).toBe('[::1]:8080');
  });
});
