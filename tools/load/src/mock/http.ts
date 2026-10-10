/**
 * HTTP plumbing for the mock: request bodies, JSON answers, and a response
 * stream that respects the socket and the client.
 *
 * A load test opens thousands of streams at once, so a stream must never
 * outlive its client (timers stop the moment the connection closes) and
 * must never buffer without bound (a slow reader makes the writer wait for
 * `drain` instead of piling chunks into memory).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Largest request body accepted: a chat with several inlined images. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** The whole request body, refused past `limit` bytes. */
export function readBody(
  req: IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        chunks.length = 0;
        reject(new BodyTooLargeError(limit));
        // Keep reading so the refusal can still be answered on this socket.
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed)
        resolve(
          chunks.length === 1 && chunks[0] ? chunks[0] : Buffer.concat(chunks),
        );
    });
    req.on('error', (error) => {
      if (failed) return;
      failed = true;
      reject(error);
    });
  });
}

/** Answer `body` as JSON with `status`, unless the client is gone. */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  if (res.headersSent || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/** Answer raw bytes, unless the client is gone. */
export function sendBytes(
  res: ServerResponse,
  status: number,
  contentType: string,
  bytes: Buffer | string,
): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(bytes),
  });
  res.end(bytes);
}

/** Headers of a Server-Sent Events answer. */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  // A reverse proxy in front of the mock must not buffer the stream.
  'x-accel-buffering': 'no',
};

/**
 * A response the mock writes over time. Writes wait for `drain` when the
 * socket buffer is full; sleeps end early, and writes stop, the moment the
 * client disconnects.
 */
export class ResponseStream {
  private readonly res: ServerResponse;
  private timer: NodeJS.Timeout | undefined;
  private wake: (() => void) | undefined;
  /** True once the connection closed (client gone or response ended). */
  closed = false;

  constructor(res: ServerResponse) {
    this.res = res;
    res.once('close', () => {
      this.closed = true;
      this.cancelSleep();
    });
  }

  /** True when the client left before the response ended. */
  get aborted(): boolean {
    return this.closed && !this.res.writableFinished;
  }

  /** Send the status line and headers now. */
  open(status: number, headers: Readonly<Record<string, string>>): void {
    if (this.closed || this.res.headersSent) return;
    this.res.writeHead(status, headers);
    this.res.flushHeaders();
  }

  /** Write `chunk`; false once the client is gone. */
  async write(chunk: string): Promise<boolean> {
    if (this.closed) return false;
    if (!this.res.write(chunk)) await this.drain();
    return !this.closed;
  }

  /** End the response (with a last chunk). */
  end(chunk?: string): void {
    if (this.closed || this.res.writableEnded) return;
    if (chunk === undefined) this.res.end();
    else this.res.end(chunk);
  }

  /**
   * Wait `ms`, or less if the client leaves. A non-positive wait still
   * yields to the event loop, so a stream that runs behind its schedule
   * cannot starve every other stream.
   */
  sleep(ms: number): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (ms <= 0) return new Promise((resolve) => setImmediate(resolve));
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.wake = undefined;
        resolve();
      }, ms);
    });
  }

  private drain(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.res.off('drain', done);
        this.res.off('close', done);
        resolve();
      };
      this.res.on('drain', done);
      this.res.on('close', done);
    });
  }

  private cancelSleep(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}

/** The header value of `name`, first one when repeated. */
export function headerValue(
  req: IncomingMessage,
  name: string,
): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
