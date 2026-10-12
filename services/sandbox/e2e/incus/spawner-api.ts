// The spawner's signed HTTP API, as the platform calls it
// (services/platform/backend/core/node_only/sandbox/helpers/session_client.ts):
// every request signed with the shared token over its method, path and query,
// timestamp, nonce and body (src/auth.ts, which this uses rather than copies).

import { randomUUID } from 'node:crypto';

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  sign,
  TIMESTAMP_HEADER,
} from '../../src/auth.ts';
import type {
  SandboxSessionProfile,
  SessionExecResponse,
  SessionInfo,
} from '../../src/wire.ts';
import { readSse, type SseEvent } from './sse.ts';
import { asText } from './util.ts';

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  /** The parsed body; undefined when it is not JSON. */
  json: unknown;
}

interface CallOptions {
  body?: unknown;
  accept?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** A create unanswered this long is slow enough to look at. */
const SLOW_CREATE_MS = 40_000;

type SlowCreateWatch = (sessionId: string, elapsedMs: number) => Promise<void>;
let slowCreateWatch: SlowCreateWatch | undefined;

/** Have `watch` called, once, for each create still unanswered after
 * SLOW_CREATE_MS (the harness reads the node then). */
export function watchSlowCreates(watch: SlowCreateWatch | undefined): void {
  slowCreateWatch = watch;
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A field of a JSON answer, or undefined when it is not there. */
export function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export interface CreateOptions {
  sessionId: string;
  organizationId?: string;
  profile?: SandboxSessionProfile;
  docker?: boolean;
  workload?: 'project' | 'workflow';
  ttlMs?: number;
  idleTimeoutMs?: number;
  env?: Record<string, string>;
}

export interface Created {
  reply: Reply;
  /** The session of a 201; undefined for any other answer. */
  session: SessionInfo | undefined;
  /** How long the call took, the waits on a runtime image still being
   * prepared included. */
  elapsedMs: number;
  /** Answers of 429 `runtime_image` that were waited out. */
  imageWaits: number;
}

export interface ExecOptions {
  execId?: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  /** The exec's own deadline in the session. */
  timeoutMs?: number;
  /** How long this client waits for the stream to end. */
  clientTimeoutMs?: number;
  collectOutput?: boolean;
  /** Called with each event as it arrives. */
  onEvent?: (event: SseEvent) => void;
}

export interface ExecOutcome {
  execId: string;
  reply: Reply;
  /** The SSE `result`; undefined when the stream gave none. */
  result: SessionExecResponse | undefined;
  /** The result's output, or the streamed chunks when there was no result. */
  stdout: string;
  stderr: string;
  events: SseEvent[];
  /** The data of an SSE `error` event. */
  streamError: unknown;
  elapsedMs: number;
}

export interface StageFile {
  path: string;
  /** Text, sent as base64. */
  content?: string;
  contentBase64?: string;
  /** Fetched by runnerd from this URL instead (the way large files travel). */
  url?: string;
  sha256?: string;
}

function decode(base64: unknown): string {
  return typeof base64 === 'string'
    ? Buffer.from(base64, 'base64').toString('utf8')
    : '';
}

function isExecResult(value: unknown): value is SessionExecResponse {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    typeof value.stdoutBase64 === 'string' &&
    typeof value.stderrBase64 === 'string'
  );
}

function isSessionInfo(value: unknown): value is SessionInfo {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.backend === 'string'
  );
}

export class SpawnerApi {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** One signed request; the answer's body is read whole. */
  async call(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<Reply> {
    const response = await this.stream(method, path, options);
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: parseJson(text),
    };
  }

  /** One signed request; the answer's body is left to the caller. */
  stream(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<Response> {
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const headers: Record<string, string> = {
      [SIGNATURE_HEADER]: sign(
        method,
        path,
        timestamp,
        body,
        this.token,
        nonce,
      ),
      [TIMESTAMP_HEADER]: timestamp,
      [NONCE_HEADER]: nonce,
    };
    if (options.body !== undefined)
      headers['content-type'] = 'application/json';
    if (options.accept !== undefined) headers.accept = options.accept;
    const signals = [
      AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ];
    if (options.signal !== undefined) signals.push(options.signal);
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body }),
      signal: AbortSignal.any(signals),
    });
  }

  /** The one unsigned route. */
  async health(timeoutMs = 10_000): Promise<Reply> {
    const response = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: parseJson(text),
    };
  }

  // ---- sessions ------------------------------------------------------------

  /**
   * POST /v1/sessions. A runtime image still being prepared answers 429
   * `runtime_image`; that is waited out for up to `imageWaitMs`, as the
   * platform would retry it.
   */
  async create(options: CreateOptions, imageWaitMs = 20 * 60_000) {
    const started = performance.now();
    const body = {
      sessionId: options.sessionId,
      organizationId: options.organizationId ?? 'e2e-org',
      profile: options.profile ?? 'agent',
      ...(options.docker === undefined ? {} : { docker: options.docker }),
      ...(options.workload === undefined ? {} : { workload: options.workload }),
      ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
      ...(options.idleTimeoutMs === undefined
        ? {}
        : { idleTimeoutMs: options.idleTimeoutMs }),
      ...(options.env === undefined ? {} : { env: options.env }),
    };
    let imageWaits = 0;
    for (;;) {
      const attempt = performance.now();
      const watch = slowCreateWatch;
      const slow =
        watch === undefined
          ? undefined
          : setTimeout(() => {
              watch(options.sessionId, performance.now() - attempt).catch(
                (error: unknown) => {
                  console.error('the slow-create look failed:', error);
                },
              );
            }, SLOW_CREATE_MS);
      let reply: Reply;
      try {
        reply = await this.call('POST', '/v1/sessions', {
          body,
          timeoutMs: 240_000,
        });
      } finally {
        clearTimeout(slow);
      }
      const waiting =
        reply.status === 429 && field(reply.json, 'error') === 'runtime_image';
      if (waiting && performance.now() - started < imageWaitMs) {
        imageWaits += 1;
        await Bun.sleep(5_000);
        continue;
      }
      const session = field(reply.json, 'session');
      const created: Created = {
        reply,
        session:
          reply.status === 201 && isSessionInfo(session) ? session : undefined,
        elapsedMs: performance.now() - started,
        imageWaits,
      };
      return created;
    }
  }

  async get(sessionId: string): Promise<Reply> {
    return this.call('GET', `/v1/sessions/${sessionId}`);
  }

  async list(organizationId: string): Promise<Reply> {
    return this.call(
      'GET',
      `/v1/sessions?organizationId=${encodeURIComponent(organizationId)}`,
    );
  }

  /** The reaper's verb: the compute goes, the workspace stays. */
  async stop(sessionId: string): Promise<Reply> {
    return this.call('DELETE', `/v1/sessions/${sessionId}?keep_workspace=1`, {
      timeoutMs: 120_000,
    });
  }

  /** The explicit Destroy: compute and workspace, waiting for the bytes. */
  async destroy(sessionId: string): Promise<Reply> {
    return this.call('DELETE', `/v1/sessions/${sessionId}?await_deletion=1`, {
      timeoutMs: 120_000,
    });
  }

  async pin(sessionId: string, pinned: boolean): Promise<Reply> {
    return this.call('PATCH', `/v1/sessions/${sessionId}/pin`, {
      body: { pinned },
    });
  }

  async patchEnv(
    sessionId: string,
    patch: { set?: Record<string, string>; unset?: string[] },
  ): Promise<Reply> {
    return this.call('PATCH', `/v1/sessions/${sessionId}/env`, { body: patch });
  }

  async acquire(sessionId: string): Promise<Reply> {
    return this.call('POST', `/v1/sessions/${sessionId}/acquire`, { body: {} });
  }

  async releaseTicket(sessionId: string): Promise<Reply> {
    return this.call('GET', `/v1/sessions/${sessionId}/release`);
  }

  async release(sessionId: string, body: unknown): Promise<Reply> {
    return this.call('POST', `/v1/sessions/${sessionId}/release`, { body });
  }

  // ---- the node and the deployment --------------------------------------------

  async limits(organizationId?: string): Promise<Reply> {
    const query =
      organizationId === undefined
        ? ''
        : `?organizationId=${encodeURIComponent(organizationId)}`;
    return this.call('GET', `/v1/limits${query}`);
  }

  async capacity(organizationId: string): Promise<Reply> {
    return this.call(
      'GET',
      `/v1/capacity?organizationId=${encodeURIComponent(organizationId)}`,
    );
  }

  async workspaces(): Promise<Reply> {
    return this.call('GET', '/v1/workspaces');
  }

  async drain(): Promise<Reply> {
    return this.call('POST', '/v1/drain', { body: {} });
  }

  async drainStatus(): Promise<Reply> {
    return this.call('GET', '/v1/drain-status');
  }

  // ---- files ------------------------------------------------------------------

  async stage(sessionId: string, files: readonly StageFile[]): Promise<Reply> {
    return this.call('POST', `/v1/sessions/${sessionId}/files/stage`, {
      body: {
        files: files.map((file) => ({
          path: file.path,
          ...(file.url === undefined
            ? {
                contentBase64:
                  file.contentBase64 ??
                  Buffer.from(file.content ?? '', 'utf8').toString('base64'),
              }
            : { url: file.url }),
          ...(file.sha256 === undefined ? {} : { sha256: file.sha256 }),
        })),
      },
      timeoutMs: 120_000,
    });
  }

  async deleteFiles(
    sessionId: string,
    paths: readonly string[],
  ): Promise<Reply> {
    return this.call('POST', `/v1/sessions/${sessionId}/files/delete`, {
      body: { paths },
    });
  }

  async listFiles(sessionId: string, path: string): Promise<Reply> {
    return this.call(
      'GET',
      `/v1/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`,
    );
  }

  /** The bytes of a file, or the reply that is not them. */
  async readFile(
    sessionId: string,
    path: string,
  ): Promise<{ reply: Reply; bytes: Uint8Array | undefined }> {
    const response = await this.stream(
      'GET',
      `/v1/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`,
      { timeoutMs: 120_000 },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    return {
      reply: {
        status: response.status,
        headers: response.headers,
        text,
        json: parseJson(text),
      },
      bytes: response.status === 200 ? bytes : undefined,
    };
  }

  // ---- exec ---------------------------------------------------------------------

  /** POST /v1/sessions/:id/exec, read to the end of its event stream. */
  async exec(sessionId: string, options: ExecOptions): Promise<ExecOutcome> {
    const started = performance.now();
    const execId =
      options.execId ?? `x${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const body = {
      execId,
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(options.shell === undefined ? {} : { shell: options.shell }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.stdin === undefined
        ? {}
        : {
            stdinBase64: Buffer.from(options.stdin, 'utf8').toString('base64'),
          }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.collectOutput === undefined
        ? {}
        : { collectOutput: options.collectOutput }),
    };
    const response = await this.stream(
      'POST',
      `/v1/sessions/${sessionId}/exec`,
      {
        body,
        accept: 'text/event-stream',
        timeoutMs: options.clientTimeoutMs ?? 5 * 60_000,
      },
    );
    const events: SseEvent[] = [];
    let result: SessionExecResponse | undefined;
    let streamError: unknown;
    let streamedOut = '';
    let streamedErr = '';
    let text = '';
    if (response.status !== 200 || response.body === null) {
      text = await response.text();
    } else {
      for await (const event of readSse(response.body)) {
        events.push(event);
        options.onEvent?.(event);
        if (event.event === 'result' && isExecResult(event.data)) {
          result = event.data;
        } else if (event.event === 'error') {
          streamError = event.data;
        } else if (event.event === 'stdout') {
          streamedOut += asText(field(event.data, 'text') ?? '');
        } else if (event.event === 'stderr') {
          streamedErr += asText(field(event.data, 'text') ?? '');
        }
      }
    }
    return {
      execId,
      reply: {
        status: response.status,
        headers: response.headers,
        text,
        json: parseJson(text),
      },
      result,
      stdout: result === undefined ? streamedOut : decode(result.stdoutBase64),
      stderr: result === undefined ? streamedErr : decode(result.stderrBase64),
      events,
      streamError,
      elapsedMs: performance.now() - started,
    };
  }

  async cancelExec(sessionId: string, execId: string): Promise<Reply> {
    return this.call(
      'POST',
      `/v1/sessions/${sessionId}/exec/${execId}/cancel`,
      {
        body: {},
      },
    );
  }
}
