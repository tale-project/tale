// Spawner-side HTTP client for a session's runnerd. Resolves the per-session
// token, calls the daemon over plain HTTP on tale-sandbox-net (Docker: the
// container DNS name; K8s: the Pod IP — both produce a base URL), and
// translates the daemon's NDJSON exec stream into the SSE callbacks the route
// layer forwards to the platform. No kubectl exec anywhere — this is ordinary
// fetch, which is what keeps the K8s backend exec-free.

import { operationSignal } from '../operation-budget.ts';
import {
  RUNNERD_CHECKPOINT_MAX_BYTES,
  isRunnerdExecEvent,
  RUNNERD_INCARNATION_HEADER,
  RUNNERD_TOKEN_HEADER,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
  type RunnerdExecStatus,
  type RunnerdHealth,
} from './runnerd-protocol.ts';

interface RunnerdClientOptions {
  baseUrl: string;
  /** Per-session token (deriveRunnerdToken), or '' in unsigned dev mode. */
  token: string;
  /** Creation stamp of the incarnation an activity request is meant for:
   * runnerd refuses the request when it serves another one. */
  incarnation?: number;
}

function authHeaders(token: string): Record<string, string> {
  return token ? { [RUNNERD_TOKEN_HEADER]: token } : {};
}

/** Short-RPC fetch timeout for runnerd calls that must return promptly
 * (cancel/stdin/env/files/fs). The long-lived streams (exec/attach) use the
 * caller's SSE signal instead — an exec can legitimately run for minutes, so a
 * short deadline would kill it. Without a timeout a hung daemon ties up the
 * spawner's connection pool until Bun's (long) default fires. */
const RUNNERD_RPC_TIMEOUT_MS = 30_000;
/** Health-probe timeout. The idle reaper probes a bounded set of sessions at
 * once, so hung daemons must not hold those lanes for the whole pass. */
const RUNNERD_HEALTH_TIMEOUT_MS = 5_000;
/** Upper bound on the inter-newline NDJSON residual. A well-behaved runnerd
 * emits newline-terminated lines (≤ a few hundred KB each); an unbounded
 * residual means a malfunctioning/compromised daemon streaming without
 * newlines — abort rather than grow the buffer until the spawner OOMs. */
const MAX_NDJSON_BUFFER_BYTES = 1_048_576;

/** Checkpoints are opaque, bounded platform state. Preserve protocol status
 * codes so an older runtime can be distinguished from an unavailable one. */
export async function runnerdExecCheckpoint(
  opts: RunnerdClientOptions,
  execId: string,
  method: 'GET' | 'PUT',
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  if (method === 'PUT') {
    if (Buffer.byteLength(body) > RUNNERD_CHECKPOINT_MAX_BYTES)
      return Response.json({ error: 'checkpoint_too_large' }, { status: 413 });
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return Response.json({ error: 'bad_checkpoint' }, { status: 400 });
    }
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('seq' in value) ||
      typeof value.seq !== 'number' ||
      !Number.isSafeInteger(value.seq) ||
      value.seq < 0 ||
      !('state' in value)
    )
      return Response.json({ error: 'bad_checkpoint' }, { status: 400 });
  }
  const response = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/checkpoint`,
    {
      method,
      headers: {
        ...authHeaders(opts.token),
        'content-type': 'application/json',
      },
      ...(method === 'PUT' ? { body } : {}),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
      ]),
    },
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

/** Corrupt execution history cannot be repaired by skipping a line or retrying
 * the same replay. The SSE boundary forwards this as a fatal replay error. */
export class RunnerdProtocolError extends Error {
  readonly code = 'REPLAY_UNAVAILABLE';

  constructor(detail: string) {
    super(`runnerd protocol: ${detail}`);
    this.name = 'RunnerdProtocolError';
  }
}

/** GET /healthz — used by create-poll and the idle reaper. Throws on
 * unreachable/non-200 so callers can distinguish "not ready yet" (retry)
 * from "degraded". */
export async function runnerdHealth(
  opts: RunnerdClientOptions,
  signal?: AbortSignal,
): Promise<RunnerdHealth> {
  const timeout = AbortSignal.timeout(RUNNERD_HEALTH_TIMEOUT_MS);
  const res = await fetch(`${opts.baseUrl}/healthz`, {
    headers: authHeaders(opts.token),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    throw new Error(`runnerd /healthz ${res.status}`);
  }
  // runnerd is a trusted peer (we built its image); the JSON shape is fixed
  // by runnerd-protocol.ts. Same narrowing pattern as validate-request.ts.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as RunnerdHealth;
}

/** The lifecycle gate must be acknowledged by runnerd itself. An older image
 * or an ambiguous response never becomes permission to reclaim compute. */
export class RunnerdActivityError extends Error {
  constructor(
    readonly status: number,
    path: string,
    /** The incarnation runnerd serves, when it refused a request meant for
     * another one. */
    readonly incarnation?: string,
  ) {
    super(`runnerd /${path} ${status}`);
  }
}

/** The incarnation a 409 `incarnation_mismatch` refusal names, if it is one. */
async function refusedIncarnation(res: Response): Promise<string | undefined> {
  if (res.status !== 409) return undefined;
  let value: unknown;
  try {
    value = await res.json();
  } catch (error) {
    console.warn('[sandbox.session] runnerd 409 answer is not JSON:', error);
    return undefined;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    !('error' in value) ||
    value.error !== 'incarnation_mismatch' ||
    !('incarnation' in value) ||
    typeof value.incarnation !== 'string'
  )
    return undefined;
  return value.incarnation;
}

/** A creation stamp as runnerd names it: a millisecond epoch in decimal. */
const INCARNATION_RE = /^[0-9]{1,16}$/;

/** Which incarnation a runnerd answer names, against the creation stamp of
 * the one the caller registered: `registered` when it names that one,
 * `replaced` when it names another (a replacement under the same name
 * answered), `unnamed` when it names none — an older runtime image, a
 * container launched without the stamp, or a malformed value — which proves
 * nothing either way. */
export function answeringIncarnation(
  createdAtMs: number,
  named: unknown,
): 'registered' | 'replaced' | 'unnamed' {
  if (typeof named !== 'string' || !INCARNATION_RE.test(named))
    return 'unnamed';
  return named === String(createdAtMs) ? 'registered' : 'replaced';
}

export async function runnerdActivity(
  opts: RunnerdClientOptions,
  action: 'ticket' | 'acquire' | 'release' | 'reclaim' | 'pin',
  body?:
    | { generation: string }
    | { claimId: string; generation: string; idleBeforeMs?: number }
    | { pinned: boolean },
): Promise<Record<string, unknown>> {
  const path = action === 'ticket' ? 'release' : action;
  const res = await fetch(`${opts.baseUrl}/${path}`, {
    method: action === 'ticket' ? 'GET' : 'POST',
    headers: {
      ...authHeaders(opts.token),
      'content-type': 'application/json',
      ...(opts.incarnation === undefined
        ? {}
        : { [RUNNERD_INCARNATION_HEADER]: String(opts.incarnation) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(RUNNERD_HEALTH_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new RunnerdActivityError(
      res.status,
      path,
      await refusedIncarnation(res),
    );
  const value: unknown = await res.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`runnerd /${path} invalid response`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** Poll liveness and required Docker readiness within one deadline, including
 * time spent inside a health request. Older runtimes omit dockerReady. */
export async function waitForRunnerd(
  opts: RunnerdClientOptions,
  deadlineMs: number,
  pollIntervalMs = 500,
  giveUp?: AbortSignal,
): Promise<void> {
  const deadline = performance.now() + deadlineMs;
  const timeout = AbortSignal.timeout(Math.max(0, Math.ceil(deadlineMs)));
  const operation = operationSignal();
  const signal = AbortSignal.any(
    [operation, timeout, giveUp].filter(
      (stop): stop is AbortSignal => stop !== undefined,
    ),
  );
  for (;;) {
    operationSignal()?.throwIfAborted();
    try {
      const health = await runnerdHealth(opts, signal);
      if (health.dockerReady !== false && !signal.aborted) return;
    } catch {
      // A failed health probe may recover while the overall budget remains.
    }
    operation?.throwIfAborted();
    giveUp?.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0 || signal.aborted)
      throw new Error(`runnerd did not become ready within ${deadlineMs}ms`);
    await new Promise((r) =>
      setTimeout(r, Math.min(pollIntervalMs, remaining)),
    );
  }
}

/**
 * POST /execs and stream the NDJSON response, invoking `onEvent` per parsed
 * daemon event in order. Resolves when the stream ends. The caller's abort
 * signal (SSE-client disconnect) aborts the fetch, which detaches the daemon's
 * response consumer. The exec keeps running for a later attach.
 */
export async function runnerdExec(
  opts: RunnerdClientOptions,
  req: RunnerdExecRequest,
  onEvent: (event: RunnerdExecEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const consumer = new AbortController();
  try {
    const res = await fetch(`${opts.baseUrl}/execs`, {
      method: 'POST',
      headers: {
        ...authHeaders(opts.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(req),
      signal: signal
        ? AbortSignal.any([signal, consumer.signal])
        : consumer.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`runnerd /execs ${res.status}`);
    }
    await pumpNdjson(res.body, onEvent);
  } finally {
    // Cancelling a body reader alone can leave Bun's HTTP fetch connected.
    // End this subscription, never the detached command behind it.
    consumer.abort();
  }
}

/** Lost history cannot be retried into a trustworthy result. */
export class RunnerdOutputGapError extends Error {
  constructor(
    message: string,
    readonly code = 'OUTPUT_GAP',
  ) {
    super(message);
  }
}

/** Read an NDJSON body, invoking `onEvent` per parsed line in order (trailing
 * partial buffered until the next chunk; final unterminated line flushed at
 * EOF). Shared by runnerdExec + runnerdAttach. */
async function pumpNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunnerdExecEvent) => void | Promise<void>,
  sinceSeq = 0,
): Promise<void> {
  let cursor = sinceSeq;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buf = '';
  let bufferedBytes = 0;
  let completed = false;
  let replayGap = false;
  const emitLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (replayGap)
      throw new RunnerdOutputGapError(
        'Exec output continued after a replay gap',
      );
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      throw new RunnerdProtocolError('invalid NDJSON record');
    }
    if (!isRunnerdExecEvent(event))
      throw new RunnerdProtocolError('invalid execution event');
    if (
      event.t === 'fail' &&
      ['OUTPUT_GAP', 'OUTPUT_LIMIT', 'REPLAY_UNAVAILABLE'].includes(event.code)
    ) {
      throw new RunnerdOutputGapError(event.message, event.code);
    }
    if (
      event.seq === undefined &&
      !['fail', 'gap', 'replay-start', 'replay-complete'].includes(event.t)
    ) {
      throw new RunnerdOutputGapError('Exec output is missing its sequence');
    }
    if (event.seq !== undefined) {
      if (event.seq !== cursor + 1) {
        throw new RunnerdOutputGapError(
          'Exec output sequence has a gap; refusing incomplete replay',
        );
      }
      cursor = event.seq;
    }
    // Consumer errors belong to the caller; never hide them as parse noise.
    await onEvent(event);
    replayGap = event.t === 'gap';
  };
  const append = (part: string) => {
    bufferedBytes += Buffer.byteLength(part);
    if (bufferedBytes > MAX_NDJSON_BUFFER_BYTES)
      throw new RunnerdProtocolError(
        `NDJSON record exceeded ${MAX_NDJSON_BUFFER_BYTES} bytes`,
      );
    buf += part;
  };
  const decode = async (value?: Uint8Array, stream = false) => {
    let chunk: string;
    try {
      chunk = decoder.decode(value, { stream });
    } catch {
      throw new RunnerdProtocolError('invalid UTF-8');
    }
    let from = 0;
    for (;;) {
      const nl = chunk.indexOf('\n', from);
      if (nl === -1) {
        append(chunk.slice(from));
        return;
      }
      append(chunk.slice(from, nl));
      await emitLine(buf);
      buf = '';
      bufferedBytes = 0;
      from = nl + 1;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      await decode(value, true);
    }
    await decode();
    await emitLine(buf);
  } finally {
    // Start detaching before a reconnect can add another subscriber, but do
    // not wait for the upstream acknowledgement: it may never settle. The
    // caller's finally must remain free to abort its owned fetch controller.
    // The detached exec itself keeps running.
    try {
      if (!completed) void reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  }
}

/** POST /execs/:id/cancel. A transport failure THROWS (the route turns it into
 * evict→404 / 502) so the platform can distinguish "exec already gone" (HTTP
 * not-ok → false) from "runnerd unreachable" — swallowing both as false hid a
 * hung daemon behind a misleading killed:false. */
export async function runnerdCancelExec(
  opts: RunnerdClientOptions,
  execId: string,
  mode: { keepLeftovers?: boolean } = {},
): Promise<boolean> {
  // `leftovers=keep`: a rotation — runnerd ends the exec's own process group
  // and holds what it left outside it for the exec that takes over.
  const query = mode.keepLeftovers === true ? '?leftovers=keep' : '';
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/cancel${query}`,
    {
      method: 'POST',
      headers: authHeaders(opts.token),
      signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
    },
  );
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const body = (await res.json()) as { killed?: boolean };
  return body.killed === true;
}

/** GET /execs/:id — per-exec status WITHOUT consuming the stream. Returns the
 * `running`/`exited` status, or `{state:'gone'}` on a 404 (evicted past the
 * recent window / never existed). Throws on any other transport failure so the
 * caller never misreads a daemon blip as "gone" (mirrors sessionExists). The
 * platform's restorative recovery keys off this: running ⇒ resume, else finalize. */
export async function runnerdExecStatus(
  opts: RunnerdClientOptions,
  execId: string,
  signal?: AbortSignal,
): Promise<RunnerdExecStatus> {
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}`,
    {
      headers: authHeaders(opts.token),
      signal: AbortSignal.any([
        AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    },
  );
  if (res.status === 404) return { execId, state: 'gone' };
  if (!res.ok) throw new Error(`runnerd GET /execs/${execId} ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as RunnerdExecStatus;
}

/** POST /execs/:id/stdin — append an NDJSON line to a held-open stdin and/or
 * close it. Throws on transport failure; structured refusals (NOT_FOUND /
 * STDIN_CLOSED / BAD_LINE / WRITE_FAILED) come back in the response body. */
export async function runnerdWriteStdin(
  opts: RunnerdClientOptions,
  execId: string,
  write: { b64?: string; eof?: boolean },
): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/stdin`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(opts.token),
        'content-type': 'application/json',
      },
      body: JSON.stringify(write),
      signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`runnerd /stdin ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as { ok: boolean; reason?: string };
}

/** Reader admission refused without changing the exec's lifecycle. */
export class RunnerdAttachBusyError extends Error {
  constructor() {
    super('runnerd replay readers are busy');
  }
}

/** GET /execs/:id/attach — reconnect to a live/recent exec; same NDJSON event
 * stream as runnerdExec. Returns false with no events if the exec is unknown
 * (404). */
export async function runnerdAttach(
  opts: RunnerdClientOptions,
  execId: string,
  onEvent: (event: RunnerdExecEvent) => void | Promise<void>,
  signal?: AbortSignal,
  sinceSeq = 0,
): Promise<boolean> {
  const q = sinceSeq !== 0 ? `?sinceSeq=${sinceSeq}` : '';
  const consumer = new AbortController();
  try {
    const res = await fetch(
      `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/attach${q}`,
      {
        headers: authHeaders(opts.token),
        signal: signal
          ? AbortSignal.any([signal, consumer.signal])
          : consumer.signal,
      },
    );
    if (res.status === 404) return false;
    if (res.status === 503) {
      const body: unknown = await res.json().catch(() => null);
      if (
        body !== null &&
        typeof body === 'object' &&
        'error' in body &&
        body.error === 'busy'
      )
        throw new RunnerdAttachBusyError();
    }
    if (!res.ok || !res.body) throw new Error(`runnerd /attach ${res.status}`);
    await pumpNdjson(res.body, onEvent, sinceSeq);
    return true;
  } finally {
    consumer.abort();
  }
}

/** PATCH the session env store (POST /env on runnerd). Returns the names the
 * daemon rejected via its deny-list. */
export async function runnerdEnvPatch(
  opts: RunnerdClientOptions,
  patch: { set?: Record<string, string>; unset?: string[] },
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${opts.baseUrl}/env`, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal: operationSignal(
      AbortSignal.any([
        AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    ),
  });
  if (!res.ok) throw new Error(`runnerd /env ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const body = (await res.json()) as { denied?: string[] };
  return body.denied ?? [];
}

/** A stage request refused before any file mutation; callers may retry it. */
export class RunnerdStageBusyError extends Error {
  constructor() {
    super('runnerd staging is busy');
  }
}

interface RunnerdStageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
  reconciled?: true;
}

/** POST /files/stage — write each item into the workspace (inline base64
 * bytes, or fetched by the daemon from its URL). */
export async function runnerdStageFiles(
  opts: RunnerdClientOptions,
  files: Array<{
    path: string;
    url?: string;
    contentBase64?: string;
    sha256?: string;
    cacheKey?: string;
    sourceId?: string;
  }>,
  reconcile: { replaceRoots?: string[]; keepPaths?: string[] } = {},
  request: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RunnerdStageResult> {
  const res = await fetch(`${opts.baseUrl}/files/stage`, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify({ files, ...reconcile }),
    signal: AbortSignal.any([
      AbortSignal.timeout(request.timeoutMs ?? RUNNERD_RPC_TIMEOUT_MS),
      ...(request.signal ? [request.signal] : []),
    ]),
  });
  if (res.status === 503) {
    const body: unknown = await res.json().catch(() => null);
    if (
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      body.error === 'busy'
    )
      throw new RunnerdStageBusyError();
  }
  if (!res.ok) throw new Error(`runnerd /files/stage ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as RunnerdStageResult;
}

interface RunnerdDeleteResult {
  deleted: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/** POST /files/delete — remove each path (file or dir, recursive) from the
 * workspace. Idempotent: an absent path counts as deleted. */
export async function runnerdDeleteFiles(
  opts: RunnerdClientOptions,
  paths: string[],
): Promise<RunnerdDeleteResult> {
  const res = await fetch(`${opts.baseUrl}/files/delete`, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
    signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`runnerd /files/delete ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as RunnerdDeleteResult;
}

interface RunnerdFsEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

/** GET /fs/list — directory entries, or null when the path is unsafe/missing. */
export async function runnerdListDir(
  opts: RunnerdClientOptions,
  path: string,
): Promise<RunnerdFsEntry[] | null> {
  const res = await fetch(
    `${opts.baseUrl}/fs/list?path=${encodeURIComponent(path)}`,
    {
      headers: authHeaders(opts.token),
      signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`runnerd /fs/list ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const body = (await res.json()) as { entries: RunnerdFsEntry[] };
  return body.entries;
}

/** GET /fs/read — file bytes, or null when unsafe/missing/oversize. */
export async function runnerdReadFile(
  opts: RunnerdClientOptions,
  path: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  const res = await fetch(
    `${opts.baseUrl}/fs/read?path=${encodeURIComponent(path)}`,
    {
      headers: authHeaders(opts.token),
      signal: AbortSignal.any([
        AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
        ...(signal === undefined ? [] : [signal]),
      ]),
    },
  );
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 404) return null;
    throw new Error(`runnerd /fs/read ${res.status}`);
  }
  return res;
}
