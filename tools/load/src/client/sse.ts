/**
 * Server-sent event streams, as a virtual user's browser tab holds them.
 *
 * Each user keeps the org realtime stream (`/events`) open for the whole
 * session and a chat thread's stream while a turn is in flight, so this
 * client is built to sit idle cheaply: one undici request per connection,
 * events parsed as they arrive with no buffering beyond the current event,
 * and an idle watchdog so a silently dead socket is noticed through the
 * server's heartbeats instead of hanging forever.
 *
 * Reconnects follow the browser's contract — the last event id goes back
 * in `Last-Event-ID`, a `retry:` field sets the reconnect base — with full
 * jitter on top, because ten thousand users dropped by one restart must not
 * come back in the same second. A refusal (401, 403, 404, or a stop event
 * such as `forbidden`) ends the stream for good: retrying a refusal is a
 * storm, not resilience.
 */

import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { createParser } from 'eventsource-parser';
import type { ParseError } from 'eventsource-parser';
import type { Dispatcher } from 'undici/index.js';

import type { MetricsRegistry } from '../metrics/registry.ts';
import { errorCode } from './http.ts';

export interface StreamEvent {
  id?: string;
  /** The `event:` field; `message` when the server sent none. */
  event: string;
  data: string;
}

export interface ReconnectOptions {
  /** Default true. */
  enabled?: boolean;
  /**
   * Delay after a healthy stream drops when the server sent no `retry:`
   * (EventSource's default, 3 s), and the first ceiling of the full-jitter
   * backoff of a stream that keeps failing.
   */
  baseMs?: number;
  /** Largest backoff ceiling. Default 60 s. */
  maxMs?: number;
}

export interface ReconnectInfo {
  /** 1 for the first reconnect after a healthy stream. */
  attempt: number;
  delayMs: number;
  /** Why the previous connection ended, e.g. `ended`, `http_502`. */
  reason: string;
}

export interface EventStreamOptions {
  agent: Dispatcher;
  /** Absolute URL, query included. */
  url: string;
  /**
   * Request headers (the cookie, a forwarded-for address). A function is
   * called on every connect, so a reconnect picks up a refreshed cookie.
   */
  headers?: Record<string, string> | (() => Record<string, string>);
  metrics: MetricsRegistry;
  /**
   * Metric prefix, e.g. `sse.events`: records `<name>.connect` (time to
   * response headers, as a request), gauge `<name>.open`, counters
   * `<name>.events` and `<name>.reconnects`, and stream errors under `<name>`.
   */
  name: string;
  /** Resume point for the first connection. */
  lastEventId?: string;
  onEvent: (event: StreamEvent) => void;
  /** Each time a connection is established. */
  onOpen?: () => void;
  /**
   * Each time an established connection ends, and exactly once when the
   * stream stops for good (`willReconnect: false`), whether or not that
   * last attempt ever connected.
   */
  onClose?: (reason: string, info: { willReconnect: boolean }) => void;
  /** Each time a reconnect is scheduled. */
  onReconnect?: (info: ReconnectInfo) => void;
  reconnect?: ReconnectOptions;
  /**
   * Event types after which the stream stops for good, recorded as an error
   * of kind `event_<type>`. Default `['forbidden']`. To end a stream on an
   * expected event (a chat turn's `settled`), call `close()` from `onEvent`.
   */
  stopOnEvents?: readonly string[];
  /**
   * Reconnect when nothing arrives for this long. The platform sends a
   * heartbeat after 15 s of silence, so the 45 s default tolerates two
   * missed heartbeats. `0` disables the watchdog.
   */
  idleTimeoutMs?: number;
  /** Largest event the parser buffers, in characters. Default 4 MiB. */
  maxEventChars?: number;
  /** Uniform [0, 1) source for the backoff jitter; injectable for tests. */
  random?: () => number;
}

export interface EventStreamHandle {
  /** Stop for good: abort the connection and any pending reconnect. */
  close(): void;
  /** Whether a connection is established right now. */
  isOpen(): boolean;
  lastEventId(): string | undefined;
  /** Reconnects scheduled so far. */
  reconnects(): number;
  /** Settles with the final reason once the stream has stopped for good. */
  readonly done: Promise<string>;
}

/** HTTP refusals that end a stream instead of scheduling a reconnect. */
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 404]);
const DEFAULT_STOP_EVENTS: readonly string[] = ['forbidden'];
/** EventSource's reconnection time when the server sent no `retry:`. */
const BROWSER_DEFAULT_RETRY_MS = 3_000;
const SAMPLE_CHARS = 300;

/**
 * Full-jitter backoff: uniform in `[0, min(maxMs, baseMs * 2^attempt))`.
 * Spreading reconnects over the whole window is what keeps a mass
 * disconnect from turning into a synchronized reconnect wave.
 */
export function fullJitterDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
  return Math.floor(random() * ceiling);
}

interface Outcome {
  /** No reconnect may follow. */
  terminal: boolean;
  reason: string;
}

function isEventStream(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value !== undefined && value.includes('text/event-stream');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EventStream implements EventStreamHandle {
  readonly done: Promise<string>;
  readonly #agent: Dispatcher;
  readonly #origin: string;
  readonly #path: string;
  readonly #headers: EventStreamOptions['headers'];
  readonly #metrics: MetricsRegistry;
  readonly #name: string;
  readonly #connectName: string;
  readonly #openName: string;
  readonly #eventsName: string;
  readonly #reconnectsName: string;
  readonly #options: EventStreamOptions;
  readonly #reconnectEnabled: boolean;
  readonly #baseMs: number;
  readonly #maxMs: number;
  readonly #stopOn: ReadonlySet<string>;
  readonly #idleTimeoutMs: number;
  readonly #random: () => number;
  #resolveDone: (reason: string) => void = () => undefined;
  #lastEventId: string | undefined;
  #retryMs: number | null = null;
  #attempt = 0;
  #reconnects = 0;
  #open = false;
  #closed = false;
  #controller: AbortController | null = null;
  #stopStream: (() => void) | null = null;
  #sleepTimer: ReturnType<typeof setTimeout> | null = null;
  #wake: (() => void) | null = null;

  constructor(options: EventStreamOptions) {
    const url = new URL(options.url);
    this.#agent = options.agent;
    this.#origin = url.origin;
    this.#path = `${url.pathname}${url.search}`;
    this.#headers = options.headers;
    this.#metrics = options.metrics;
    this.#name = options.name;
    this.#connectName = `${options.name}.connect`;
    this.#openName = `${options.name}.open`;
    this.#eventsName = `${options.name}.events`;
    this.#reconnectsName = `${options.name}.reconnects`;
    this.#options = options;
    this.#reconnectEnabled = options.reconnect?.enabled ?? true;
    this.#baseMs = options.reconnect?.baseMs ?? BROWSER_DEFAULT_RETRY_MS;
    this.#maxMs = options.reconnect?.maxMs ?? 60_000;
    this.#stopOn = new Set(options.stopOnEvents ?? DEFAULT_STOP_EVENTS);
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
    this.#random = options.random ?? Math.random;
    this.#lastEventId = options.lastEventId;
    this.done = new Promise((resolve) => {
      this.#resolveDone = resolve;
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#sleepTimer !== null) {
      clearTimeout(this.#sleepTimer);
      this.#sleepTimer = null;
    }
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
    const stop = this.#stopStream;
    this.#stopStream = null;
    stop?.();
    this.#controller?.abort();
  }

  isOpen(): boolean {
    return this.#open;
  }

  lastEventId(): string | undefined {
    return this.#lastEventId;
  }

  reconnects(): number {
    return this.#reconnects;
  }

  start(): void {
    this.#run().then(
      (reason) => this.#resolveDone(reason),
      (error: unknown) => {
        // The loop catches everything it expects; reaching here is a bug in
        // this module, and a load run must surface it without crashing.
        console.error(`event stream ${this.#name} failed`, error);
        this.#metrics.error(this.#name, 'internal', messageOf(error));
        this.#resolveDone('internal_error');
      },
    );
  }

  async #run(): Promise<string> {
    for (;;) {
      if (this.#closed) {
        this.#notifyClose('closed', false);
        return 'closed';
      }
      const { opened, outcome } = await this.#connectOnce();
      const willReconnect =
        !outcome.terminal && !this.#closed && this.#reconnectEnabled;
      if (!willReconnect) {
        const reason = this.#closed ? 'closed' : outcome.reason;
        this.#notifyClose(reason, false);
        return reason;
      }
      if (opened) {
        this.#notifyClose(outcome.reason, true);
      }
      const base = this.#retryMs ?? this.#baseMs;
      const max = Math.max(this.#maxMs, this.#retryMs ?? 0);
      // A stream that was healthy comes back the way a browser's EventSource
      // does — after the server's `retry:` (the platform jitters it per
      // stream), else the browser's default — so a deploy that drops every
      // stream does not see them all back within a second. Only a stream
      // that keeps failing backs off with full jitter.
      const delayMs =
        opened && this.#attempt === 0
          ? base
          : fullJitterDelay(this.#attempt, base, max, this.#random);
      this.#attempt += 1;
      this.#reconnects += 1;
      this.#metrics.counter(this.#reconnectsName);
      this.#call('onReconnect', () =>
        this.#options.onReconnect?.({
          attempt: this.#attempt,
          delayMs,
          reason: outcome.reason,
        }),
      );
      await this.#sleep(delayMs);
    }
  }

  async #connectOnce(): Promise<{ opened: boolean; outcome: Outcome }> {
    const controller = new AbortController();
    this.#controller = controller;
    const started = performance.now();
    let response: Dispatcher.ResponseData;
    try {
      response = await this.#agent.request({
        origin: this.#origin,
        path: this.#path,
        method: 'GET',
        headers: this.#requestHeaders(),
        signal: controller.signal,
        bodyTimeout: 0,
      });
    } catch (error) {
      if (this.#closed) {
        return { opened: false, outcome: { terminal: true, reason: 'closed' } };
      }
      const kind = `net_${errorCode(error)}`;
      this.#metrics.request(this.#connectName, performance.now() - started, 0);
      this.#metrics.error(
        this.#connectName,
        kind,
        `GET ${this.#path}: ${messageOf(error)}`,
      );
      return { opened: false, outcome: { terminal: false, reason: kind } };
    }

    const status = response.statusCode;
    this.#metrics.request(
      this.#connectName,
      performance.now() - started,
      status,
    );
    if (status !== 200 || !isEventStream(response.headers['content-type'])) {
      const sample = await this.#drain(response.body);
      const kind = status === 200 ? 'sse_content_type' : `http_${status}`;
      this.#metrics.error(
        this.#connectName,
        kind,
        `GET ${this.#path} -> ${status}: ${sample}`,
      );
      if (REFUSALS.has(status)) {
        return {
          opened: false,
          outcome: { terminal: true, reason: `refused_${status}` },
        };
      }
      return { opened: false, outcome: { terminal: false, reason: kind } };
    }
    if (this.#closed) {
      response.body.destroy();
      return { opened: false, outcome: { terminal: true, reason: 'closed' } };
    }

    this.#open = true;
    this.#metrics.gauge(this.#openName, 1);
    this.#call('onOpen', () => this.#options.onOpen?.());
    const outcome = await this.#consume(response.body);
    this.#open = false;
    this.#metrics.gauge(this.#openName, -1);
    return { opened: true, outcome };
  }

  /** Read events until the connection ends; resolves with why it ended. */
  #consume(body: Readable): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      let settled = false;
      let idle: ReturnType<typeof setTimeout> | null = null;
      const settle = (terminal: boolean, reason: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (idle !== null) {
          clearTimeout(idle);
        }
        this.#stopStream = null;
        resolve({ terminal, reason });
        if (!body.destroyed) {
          body.destroy();
        }
      };
      this.#stopStream = () => settle(true, 'closed');

      const parser = createParser({
        maxBufferSize: this.#options.maxEventChars ?? 4 * 1024 * 1024,
        onId: (id) => {
          this.#lastEventId = id === '' ? undefined : id;
        },
        onRetry: (ms) => {
          this.#retryMs = ms;
        },
        onEvent: (message) => {
          if (settled) {
            return;
          }
          const event = message.event ?? 'message';
          this.#metrics.counter(this.#eventsName);
          // A stream that delivers is healthy: the next drop starts the
          // backoff from the bottom again.
          this.#attempt = 0;
          try {
            this.#options.onEvent({
              id: message.id,
              event,
              data: message.data,
            });
          } catch (error) {
            this.#metrics.error(this.#name, 'handler_error', messageOf(error));
          }
          if (this.#closed) {
            settle(true, 'closed');
            return;
          }
          if (this.#stopOn.has(event)) {
            this.#metrics.error(
              this.#name,
              `event_${event}`,
              message.data.slice(0, SAMPLE_CHARS),
            );
            settle(true, `event_${event}`);
          }
        },
        onError: (error: ParseError) => {
          if (error.type === 'max-buffer-size-exceeded') {
            this.#metrics.error(
              this.#name,
              'sse_buffer_overflow',
              error.message,
            );
            settle(false, 'sse_buffer_overflow');
            return;
          }
          // Unknown fields and malformed `retry:` values are skipped by the
          // parser, as the spec asks; count them so a protocol drift shows.
          this.#metrics.counter(`${this.#name}.parse_errors`);
        },
      });

      if (this.#idleTimeoutMs > 0) {
        idle = setTimeout(() => {
          this.#metrics.error(
            this.#name,
            'idle_timeout',
            `no data for ${this.#idleTimeoutMs} ms on ${this.#path}`,
          );
          settle(false, 'idle_timeout');
        }, this.#idleTimeoutMs);
      }

      // Decode by hand rather than through `setEncoding`: undici's body
      // stream does not honour it on every runtime, and a multi-byte
      // character split across two chunks must still decode whole.
      const decoder = new StringDecoder('utf8');
      body.on('data', (chunk: Buffer | string) => {
        if (settled) {
          return;
        }
        idle?.refresh();
        try {
          parser.feed(typeof chunk === 'string' ? chunk : decoder.write(chunk));
        } catch (error) {
          this.#metrics.error(this.#name, 'sse_parse', messageOf(error));
          settle(false, 'sse_parse');
        }
      });
      body.on('end', () => settle(false, 'ended'));
      body.on('error', (error: unknown) => {
        // Destroying the body after a settle (a stop event, a parse
        // failure, the watchdog) surfaces here as an abort: already handled.
        if (settled) {
          return;
        }
        if (this.#closed) {
          settle(true, 'closed');
          return;
        }
        const kind = `net_${errorCode(error)}`;
        this.#metrics.error(this.#name, kind, messageOf(error));
        settle(false, kind);
      });
      body.on('close', () =>
        settle(this.#closed, this.#closed ? 'closed' : 'ended'),
      );
    });
  }

  #requestHeaders(): Record<string, string> {
    const base =
      typeof this.#headers === 'function' ? this.#headers() : this.#headers;
    const headers: Record<string, string> = {
      ...base,
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
    };
    if (this.#lastEventId !== undefined) {
      headers['last-event-id'] = this.#lastEventId;
    }
    return headers;
  }

  /** A refused response's body, bounded, for the error sample. */
  async #drain(body: Readable & { text(): Promise<string> }): Promise<string> {
    try {
      return (await body.text()).slice(0, SAMPLE_CHARS);
    } catch (error) {
      return `(body unreadable: ${messageOf(error)})`;
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.#closed) {
        resolve();
        return;
      }
      this.#wake = resolve;
      this.#sleepTimer = setTimeout(() => {
        this.#sleepTimer = null;
        this.#wake = null;
        resolve();
      }, ms);
    });
  }

  #notifyClose(reason: string, willReconnect: boolean): void {
    this.#call('onClose', () =>
      this.#options.onClose?.(reason, { willReconnect }),
    );
  }

  /** Run a caller hook; a throwing hook is recorded, never fatal. */
  #call(hook: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.#metrics.error(
        this.#name,
        'handler_error',
        `${hook}: ${messageOf(error)}`,
      );
    }
  }
}

/** Open an event stream; it connects (and reconnects) in the background. */
export function openEventStream(
  options: EventStreamOptions,
): EventStreamHandle {
  const stream = new EventStream(options);
  stream.start();
  return stream;
}
