// Spawner-side HTTP client for a session's runnerd. Resolves the per-session
// token, calls the daemon over plain HTTP on tale-sandbox-net (Docker: the
// container DNS name; K8s: the Pod IP — both produce a base URL), and
// translates the daemon's NDJSON exec stream into the SSE callbacks the route
// layer forwards to the platform. No kubectl exec anywhere — this is ordinary
// fetch, which is what keeps the K8s backend exec-free.

import {
  RUNNERD_TOKEN_HEADER,
  type RunnerdBrowserClosePages,
  type RunnerdBrowserRecycle,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
  type RunnerdExecStatus,
  type RunnerdHealth,
} from './runnerd-protocol.ts';

interface RunnerdClientOptions {
  baseUrl: string;
  /** Per-session token (deriveRunnerdToken), or '' in unsigned dev mode. */
  token: string;
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
/** Health-probe timeout. The idle reaper hits /healthz once per session in a
 * sequential sweep, so a single hung daemon must not stall the whole pass. */
const RUNNERD_HEALTH_TIMEOUT_MS = 5_000;
/** Upper bound on the inter-newline NDJSON residual. A well-behaved runnerd
 * emits newline-terminated lines (≤ a few hundred KB each); an unbounded
 * residual means a malfunctioning/compromised daemon streaming without
 * newlines — abort rather than grow the buffer until the spawner OOMs. */
const MAX_NDJSON_BUFFER_BYTES = 1_048_576;

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

/** Poll /healthz until it answers 200 or the deadline passes. Resolves once
 * the daemon is ready; throws on timeout. */
export async function waitForRunnerd(
  opts: RunnerdClientOptions,
  deadlineMs: number,
  pollIntervalMs = 500,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      await runnerdHealth(opts);
      return;
    } catch {
      if (Date.now() - start > deadlineMs) {
        throw new Error(`runnerd did not become ready within ${deadlineMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}

/**
 * POST /execs and stream the NDJSON response, invoking `onEvent` per parsed
 * daemon event in order. Resolves when the stream ends. The caller's abort
 * signal (SSE-client disconnect) aborts the fetch, which closes the daemon's
 * request and cancels the exec daemon-side.
 */
export async function runnerdExec(
  opts: RunnerdClientOptions,
  req: RunnerdExecRequest,
  onEvent: (event: RunnerdExecEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/execs`, {
    method: 'POST',
    headers: {
      ...authHeaders(opts.token),
      'content-type': 'application/json',
    },
    body: JSON.stringify(req),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    throw new Error(`runnerd /execs ${res.status}`);
  }
  await pumpNdjson(res.body, onEvent);
}

/** Read an NDJSON body, invoking `onEvent` per parsed line in order (trailing
 * partial buffered until the next chunk; final unterminated line flushed at
 * EOF). Shared by runnerdExec + runnerdAttach. */
async function pumpNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunnerdExecEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  const emitLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      onEvent(JSON.parse(trimmed) as RunnerdExecEvent);
    } catch (err) {
      console.warn('[sandbox.session] bad NDJSON line from runnerd:', err);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      emitLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
    // Bound the residual partial line: a daemon streaming without newlines
    // would otherwise grow `buf` until the spawner OOMs. Abort the pump (the
    // route's catch sends `error` + evicts a gone backend).
    if (buf.length > MAX_NDJSON_BUFFER_BYTES) {
      throw new Error(
        `runnerd NDJSON exceeded ${MAX_NDJSON_BUFFER_BYTES} bytes without a newline`,
      );
    }
  }
  emitLine(buf);
}

/** POST /execs/:id/cancel. A transport failure THROWS (the route turns it into
 * evict→404 / 502) so the platform can distinguish "exec already gone" (HTTP
 * not-ok → false) from "runnerd unreachable" — swallowing both as false hid a
 * hung daemon behind a misleading killed:false. */
export async function runnerdCancelExec(
  opts: RunnerdClientOptions,
  execId: string,
): Promise<boolean> {
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/cancel`,
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

/** POST /browser/{restart,reset,close-pages} — recycle/reset the managed
 * live-browser Chromium, or close its tabs. Returns the daemon's JSON body
 * (RunnerdBrowserRecycle | RunnerdBrowserClosePages) verbatim for the route to
 * forward to the platform. Throws on transport failure. */
export async function runnerdBrowserControl(
  opts: RunnerdClientOptions,
  action: 'restart' | 'reset' | 'close-pages',
): Promise<RunnerdBrowserRecycle | RunnerdBrowserClosePages> {
  const res = await fetch(`${opts.baseUrl}/browser/${action}`, {
    method: 'POST',
    headers: authHeaders(opts.token),
    signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`runnerd /browser/${action} ${res.status}`);
  // Trusted peer; shape fixed by runnerd-protocol.ts (restart/reset →
  // RunnerdBrowserRecycle, close-pages → RunnerdBrowserClosePages).
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as RunnerdBrowserRecycle | RunnerdBrowserClosePages;
}

/** GET /execs/:id — per-exec status WITHOUT consuming the stream. Returns the
 * `running`/`exited` status, or `{state:'gone'}` on a 404 (evicted past the
 * recent window / never existed). Throws on any other transport failure so the
 * caller never misreads a daemon blip as "gone" (mirrors sessionExists). The
 * platform's restorative recovery keys off this: running ⇒ resume, else finalize. */
export async function runnerdExecStatus(
  opts: RunnerdClientOptions,
  execId: string,
): Promise<RunnerdExecStatus> {
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}`,
    {
      headers: authHeaders(opts.token),
      signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
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

/** GET /execs/:id/attach — reconnect to a live/recent exec; same NDJSON event
 * stream as runnerdExec. Returns false with no events if the exec is unknown
 * (404). */
export async function runnerdAttach(
  opts: RunnerdClientOptions,
  execId: string,
  onEvent: (event: RunnerdExecEvent) => void,
  signal?: AbortSignal,
  sinceSeq = 0,
): Promise<boolean> {
  const q = sinceSeq > 0 ? `?sinceSeq=${sinceSeq}` : '';
  const res = await fetch(
    `${opts.baseUrl}/execs/${encodeURIComponent(execId)}/attach${q}`,
    { headers: authHeaders(opts.token), ...(signal ? { signal } : {}) },
  );
  if (res.status === 404) return false;
  if (!res.ok || !res.body) throw new Error(`runnerd /attach ${res.status}`);
  await pumpNdjson(res.body, onEvent);
  return true;
}

/** PATCH the session env store (POST /env on runnerd). Returns the names the
 * daemon rejected via its deny-list. */
export async function runnerdEnvPatch(
  opts: RunnerdClientOptions,
  patch: { set?: Record<string, string>; unset?: string[] },
): Promise<string[]> {
  const res = await fetch(`${opts.baseUrl}/env`, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`runnerd /env ${res.status}`);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const body = (await res.json()) as { denied?: string[] };
  return body.denied ?? [];
}

interface RunnerdStageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

/** POST /files/stage — write each item into the workspace (inline base64
 * bytes, or fetched by the daemon from its URL). */
export async function runnerdStageFiles(
  opts: RunnerdClientOptions,
  files: Array<{ path: string; url?: string; contentBase64?: string }>,
): Promise<RunnerdStageResult> {
  const res = await fetch(`${opts.baseUrl}/files/stage`, {
    method: 'POST',
    headers: { ...authHeaders(opts.token), 'content-type': 'application/json' },
    body: JSON.stringify({ files }),
    signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
  });
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
): Promise<ArrayBuffer | null> {
  const res = await fetch(
    `${opts.baseUrl}/fs/read?path=${encodeURIComponent(path)}`,
    {
      headers: authHeaders(opts.token),
      signal: AbortSignal.timeout(RUNNERD_RPC_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`runnerd /fs/read ${res.status}`);
  return res.arrayBuffer();
}
