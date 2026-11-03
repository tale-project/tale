// The heads of HTTP/1.x messages on a socket: reading one, taking it apart.
// Shared by the tunnel setup (`connect.ts`), the bridge and the exit-IP check.
// Heads are latin-1 strings, so a byte that is not ASCII survives a round trip.

import { Buffer } from 'node:buffer';
import type { Readable } from 'node:stream';

/** Request and response heads (large cookies) are limited to this many bytes. */
export const HEAD_LIMIT = 256 * 1024;

const TERMINATOR = Buffer.from('\r\n\r\n');

/** A head that never ended, was too large, or is not valid HTTP. */
export class HeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeadError';
  }
}

export type Header = readonly [name: string, value: string];

// Hop-by-hop headers: never forwarded. This drops the client's own Proxy-Authorization.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);

/**
 * Read up to the blank line that ends an HTTP head and return the head,
 * terminator included.
 *
 * What came in after it stays on the socket: it is pushed back, and the socket
 * is left paused. Whoever takes over resumes it, in the same step it starts
 * listening (`pipe()` does), because a flowing socket nobody listens to loses
 * data.
 *
 * With `timeoutMs` a head that is not all there by then fails: a peer that
 * connects and says nothing, or says a little, is not waited for for ever.
 */
export function readHead(
  socket: Readable,
  limit = HEAD_LIMIT,
  timeoutMs?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed || socket.readableEnded) {
      reject(new HeadError('connection closed before the end of the head'));
      return;
    }
    let buffered: Buffer = Buffer.alloc(0);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const done = (settle: () => void) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onClosed);
      socket.off('close', onClosed);
      socket.off('error', onError);
      socket.pause();
      settle();
    };
    function onData(chunk: Buffer) {
      const searchFrom = Math.max(0, buffered.length - TERMINATOR.length + 1);
      buffered =
        buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      const at = buffered.indexOf(TERMINATOR, searchFrom);
      if (at >= 0 && at <= limit) {
        const end = at + TERMINATOR.length;
        done(() => {
          const rest = buffered.subarray(end);
          if (rest.length > 0) socket.unshift(rest);
          resolve(buffered.toString('latin1', 0, end));
        });
      } else if (at >= 0 || buffered.length > limit) {
        done(() => reject(new HeadError('head too large')));
      }
    }
    function onClosed() {
      done(() =>
        reject(new HeadError('connection closed before the end of the head')),
      );
    }
    function onError(error: Error) {
      done(() => reject(error));
    }
    socket.on('data', onData);
    socket.once('end', onClosed);
    socket.once('close', onClosed);
    socket.once('error', onError);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        done(() => reject(new HeadError('the head did not arrive in time')));
      }, timeoutMs);
    }
    socket.resume();
  });
}

/** The start line and the header lines of a head. */
export function splitHead(head: string): {
  startLine: string;
  lines: string[];
} {
  const [startLine = '', ...lines] = head.split('\r\n');
  // A stray CR or LF would let a header smuggle another one upstream.
  if (
    [startLine, ...lines].some(
      (line) => line.includes('\r') || line.includes('\n'),
    )
  ) {
    throw new HeadError('stray line break');
  }
  return { startLine, lines };
}

export function parseHeaders(lines: readonly string[]): Header[] {
  const headers: Header[] = [];
  for (const line of lines) {
    const colon = line.indexOf(':');
    const name = colon < 0 ? '' : line.slice(0, colon).trim();
    if (name !== '') headers.push([name, line.slice(colon + 1).trim()]);
  }
  return headers;
}

/** Drop the hop-by-hop headers, including any that `Connection` names. */
export function endToEnd(headers: readonly Header[]): Header[] {
  const drop = new Set(HOP_BY_HOP);
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (lower !== 'connection' && lower !== 'proxy-connection') continue;
    for (const token of value.split(',')) drop.add(token.trim().toLowerCase());
  }
  return headers.filter(([name]) => !drop.has(name.toLowerCase()));
}

/** The first value of a header, case-insensitively. */
export function headerValue(
  headers: readonly Header[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([candidate]) => candidate.toLowerCase() === lower)?.[1];
}

const STATUS_LINE = /^(HTTP\/\S*) ([0-9]{3})(?: (.*))?$/;

/** `(status, reason)` of an HTTP response's start line. Throws `HeadError`. */
export function parseStatusLine(startLine: string): {
  status: number;
  reason: string;
} {
  const match = STATUS_LINE.exec(startLine);
  if (!match) throw new HeadError('not an HTTP response');
  return {
    status: Number.parseInt(match[2] ?? '', 10),
    reason: (match[3] ?? '').trim(),
  };
}

/** A head as bytes: the lines, a blank line. */
export function headBytes(lines: readonly string[]): Buffer {
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
}

/** `host:port`, with an IPv6 literal in brackets. */
export function hostAndPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}
