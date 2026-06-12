'use node';

// Platform → spawner client for the persistent-session API. Mirrors
// spawner_client.ts (same HMAC signing contract + SANDBOX_URL/SANDBOX_TOKEN
// env), adds the session verbs. Lives in node_only because it streams SSE.
//
// Signature contract (services/sandbox/src/auth.ts):
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)

import { createHash, createHmac } from 'node:crypto';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

function signRequest(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  token: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
  return createHmac('sha256', token).update(signedString).digest('hex');
}

/** The session is gone spawner-side (404). NOT a transient drop — the resilient
 * drain must not retry it, and the caller self-heals the stale platform row. */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

function getSpawnerUrl(): string {
  return process.env.SANDBOX_URL ?? 'http://localhost:8003';
}

function getSpawnerToken(): string | null {
  const token = process.env.SANDBOX_TOKEN;
  return token && token.length > 0 ? token : null;
}

/** Build signed headers for a request to the spawner (method + path + body). */
function signedHeaders(
  method: string,
  path: string,
  body: string,
  accept?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (accept) headers.accept = accept;
  const token = getSpawnerToken();
  if (token !== null) {
    const timestamp = String(Date.now());
    headers[SIGNATURE_HEADER] = signRequest(
      method,
      path,
      timestamp,
      body,
      token,
    );
    headers[TIMESTAMP_HEADER] = timestamp;
  }
  return headers;
}

export interface SessionCreateBody {
  sessionId: string;
  organizationId: string;
  profile: 'default' | 'agent';
  ttlMs?: number;
  idleTimeoutMs?: number;
  env?: Record<string, string>;
}

export interface SessionInfo {
  sessionId: string;
  organizationId: string;
  profile: 'default' | 'agent';
  state: string;
  backend: string;
  createdAtMs: number;
  lastActivityAtMs: number;
  expiresAtMs: number;
  idleTimeoutMs: number;
}

const CREATE_TIMEOUT_MS = 200_000; // create polls runnerd readiness (≤180s)
// Grace added to the caller's exec timeoutMs for the SSE fetch, so the stream
// outlives the sandbox-side exec deadline and delivers the terminal result
// instead of aborting first (the old code hardcoded 60s here too).
const EXEC_FETCH_GRACE_MS = 60_000;
// Fallback fetch deadline when a caller omits timeoutMs. Env-tunable; the
// real value is supplied per-turn by run_external_agent (TURN_TIMEOUT_MS). The
// per-action window (ACTION_WINDOW_MS) aborts the fetch far sooner via the
// budget controller, so this is just the outer bound.
const EXEC_FALLBACK_TIMEOUT_MS = Number(
  process.env.EXTERNAL_AGENT_TURN_TIMEOUT_MS ?? String(24 * 60 * 60 * 1000),
);
// Resilient-drain reconnect bounds: max CONSECUTIVE failed re-attaches (reset on
// progress) before giving up, and the linear backoff between them.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;

/** POST /v1/sessions — create + wait for runnerd ready. Throws on 4xx/5xx. */
export async function sessionCreate(
  body: SessionCreateBody,
): Promise<SessionInfo> {
  const path = '/v1/sessions';
  const bodyJson = JSON.stringify(body);
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, bodyJson),
    body: bodyJson,
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `sandbox session create failed (${res.status}): ${await safeText(res)}`,
    );
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { session: SessionInfo };
  return parsed.session;
}

/** DELETE /v1/sessions/:id — idempotent teardown. */
export async function sessionDestroy(sessionId: string): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}`;
  const headers = signedHeaders('DELETE', path, '');
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { destroyed?: boolean };
  return parsed.destroyed === true;
}

/** PATCH /v1/sessions/:id/env — inject/rotate session env (gateway token,
 * integration creds). Returns the names runnerd rejected (deny-list). */
export async function sessionEnvPatch(
  sessionId: string,
  patch: { set?: Record<string, string>; unset?: string[] },
): Promise<string[]> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/env`;
  const bodyJson = JSON.stringify(patch);
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'PATCH',
    headers: signedHeaders('PATCH', path, bodyJson),
    body: bodyJson,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`sandbox session env patch failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { denied?: string[] };
  return parsed.denied ?? [];
}

/** PATCH /v1/sessions/:id/pin — toggle the spawner-side "always-on" reaper
 * exemption. Best-effort; the platform `sandboxSessions.pinned` row is the
 * durable truth (re-pushed on the next turn after a spawner restart). */
export async function sessionSetPinned(
  sessionId: string,
  pinned: boolean,
): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/pin`;
  const bodyJson = JSON.stringify({ pinned });
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'PATCH',
    headers: signedHeaders('PATCH', path, bodyJson),
    body: bodyJson,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { pinned?: boolean };
  return parsed.pinned === pinned;
}

/** POST /v1/sessions/:id/exec/:execId/cancel — SIGTERM→SIGKILL the exec's
 * process group in the sandbox. Idempotent (false if the exec/session is gone).
 * The Stop-button path for external-agent turns; the run's own finalize then
 * persists the partial timeline + marks the message failed. */
export async function sessionCancelExec(
  sessionId: string,
  execId: string,
): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/cancel`;
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, ''),
    body: '',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { killed?: boolean };
  return parsed.killed === true;
}

export interface SessionStageFile {
  /** Workspace-relative destination path. */
  path: string;
  /** Presigned URL the daemon fetches (exactly one of url/contentBase64). */
  url?: string;
  /** Inline bytes, base64 — for small control files (steer messages). */
  contentBase64?: string;
}

export interface SessionStageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
}

/** POST /v1/sessions/:id/files/stage — write files into the session workspace.
 * Throws on transport/HTTP failure; per-file failures come back in `skipped`. */
export async function sessionStageFiles(
  sessionId: string,
  files: SessionStageFile[],
): Promise<SessionStageResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files/stage`;
  const bodyJson = JSON.stringify({ files });
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, bodyJson),
    body: bodyJson,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) throw new SessionNotFoundError(sessionId);
  if (!res.ok) {
    throw new Error(`sandbox session files stage failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as SessionStageResult;
}

export interface SessionFsEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

/** GET /v1/sessions/:id/files?path= — workspace directory listing. Returns
 * null when the path (or the session) is gone — callers treat that as "nothing
 * to reconcile", not an error. */
export async function sessionListFiles(
  sessionId: string,
  dirPath: string,
): Promise<SessionFsEntry[] | null> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(dirPath)}`;
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'GET',
    headers: signedHeaders('GET', path, ''),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`sandbox session files list failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { entries?: SessionFsEntry[] };
  return parsed.entries ?? [];
}

export interface SessionExecBody {
  execId: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdinBase64?: string;
  timeoutMs?: number;
}

export interface SessionExecResult {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  durationMs: number;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: { stdout: boolean; stderr: boolean };
  errorCode?: string;
  errorMessage?: string;
}

export interface SessionExecCallbacks {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

/**
 * POST /v1/sessions/:id/exec as SSE. Streams stdout/stderr deltas to the
 * callbacks (the progress-bridge action feeds these through the agent adapter
 * parser) and returns the terminal result. The raw stdout deltas are exactly
 * the agent's stream-json / JSONL bytes — byte-faithful and ordered.
 */
export async function sessionExec(
  sessionId: string,
  body: SessionExecBody,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  cursor?: ExecCursor,
): Promise<SessionExecResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec`;
  const bodyJson = JSON.stringify(body);
  // One healthy connection holds for the whole turn (timeoutMs + grace); the
  // resilient drain only re-attaches when this connection actually DROPS before
  // the terminal result (network blip / spawner restart), not on a fixed cycle.
  const fetchAbort = AbortSignal.any([
    signal,
    AbortSignal.timeout(
      (body.timeoutMs ?? EXEC_FALLBACK_TIMEOUT_MS) + EXEC_FETCH_GRACE_MS,
    ),
  ]);
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, bodyJson, 'text/event-stream'),
    body: bodyJson,
    signal: fetchAbort,
  });
  if (res.status === 404) throw new SessionNotFoundError(sessionId);
  if (!res.ok || !res.body) {
    throw new Error(`sandbox session exec failed (${res.status})`);
  }
  return consumeExecSse(res.body, callbacks, cursor);
}

/**
 * GET /v1/sessions/:id/exec/:execId/attach?sinceSeq= as SSE — reconnect to a
 * running (or just-finished) exec and resume the stream from `sinceSeq`. Same
 * event grammar + return as sessionExec; throws on a non-terminal end so the
 * drain retries. The detach-grace on runnerd keeps the child alive across the
 * gap, and the seq cursor makes the replay idempotent.
 */
export async function sessionAttachExec(
  sessionId: string,
  execId: string,
  sinceSeq: number,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  cursor?: ExecCursor,
  timeoutMs?: number,
): Promise<SessionExecResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/attach`;
  const query = sinceSeq > 0 ? `?sinceSeq=${sinceSeq}` : '';
  const fetchAbort = AbortSignal.any([
    signal,
    AbortSignal.timeout(
      (timeoutMs ?? EXEC_FALLBACK_TIMEOUT_MS) + EXEC_FETCH_GRACE_MS,
    ),
  ]);
  const res = await fetch(`${getSpawnerUrl()}${path}${query}`, {
    method: 'GET',
    headers: signedHeaders('GET', path, '', 'text/event-stream'),
    signal: fetchAbort,
  });
  if (res.status === 404) throw new SessionNotFoundError(sessionId);
  if (!res.ok || !res.body) {
    throw new Error(`sandbox session attach failed (${res.status})`);
  }
  return consumeExecSse(res.body, callbacks, cursor);
}

/**
 * Resilient drain: run an exec and, on any NON-terminal end (connection drop,
 * window timeout, transient error), re-attach via sinceSeq and keep going until
 * the terminal result — so a single turn is no longer bound to one HTTP
 * connection. The same callbacks (hence the same in-memory parser) are fed
 * across reconnects; the cursor guarantees no missed or double-counted events.
 *
 * Bounded by MAX_RECONNECT_ATTEMPTS *consecutive* failures (reset whenever a
 * reconnect makes progress) so a truly-dead exec doesn't loop forever; a
 * caller-aborted signal stops immediately (an explicit Stop already yields a
 * terminal 'cancelled' result, so it doesn't reach here).
 */
export async function drainSessionExecResilient(
  sessionId: string,
  body: SessionExecBody,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  opts: { cursor?: ExecCursor; resumeSinceSeq?: number } = {},
): Promise<SessionExecResult> {
  // External cursor lets the caller (run_agent) read the resume position; on a
  // continuation it starts at the handoff seq. `resumeSinceSeq` makes the FIRST
  // attempt an attach (no new exec — the exec is already running in the sandbox).
  const cursor: ExecCursor = opts.cursor ?? {
    lastSeq: opts.resumeSinceSeq ?? 0,
  };
  const startWithAttach = opts.resumeSinceSeq !== undefined;
  let attempt = 0;
  let seqAtAttemptStart = cursor.lastSeq;
  for (;;) {
    try {
      return startWithAttach || attempt > 0
        ? await sessionAttachExec(
            sessionId,
            body.execId,
            cursor.lastSeq,
            signal,
            callbacks,
            cursor,
            body.timeoutMs,
          )
        : await sessionExec(sessionId, body, signal, callbacks, cursor);
    } catch (err) {
      if (signal.aborted) throw err;
      // A 404 means the session is gone, not a transient drop — retrying can't
      // help. Surface it so the caller self-heals the stale platform row.
      if (err instanceof SessionNotFoundError) throw err;
      // Progress since the last failure resets the consecutive-failure budget.
      if (cursor.lastSeq > seqAtAttemptStart) attempt = 0;
      seqAtAttemptStart = cursor.lastSeq;
      attempt += 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) throw err;
      console.warn(
        `[session_client] exec ${body.execId} stream dropped (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}, sinceSeq=${cursor.lastSeq}); re-attaching:`,
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) =>
        setTimeout(r, Math.min(RECONNECT_BACKOFF_MS * attempt, MAX_BACKOFF_MS)),
      );
    }
  }
}

/** Reconnect cursor: the highest runnerd event `seq` consumed so far. A
 * resilient drain passes this so a re-attach replays only newer events. */
export interface ExecCursor {
  lastSeq: number;
}

async function consumeExecSse(
  body: ReadableStream<Uint8Array>,
  callbacks: SessionExecCallbacks,
  cursor?: ExecCursor,
): Promise<SessionExecResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let result: SessionExecResult | null = null;
  const handleEvent = (event: string, data: string): void => {
    if (event === 'stdout' || event === 'stderr') {
      const parsed = parseData<{ text?: string; seq?: number }>(data);
      const text = parsed?.text ?? '';
      // Advance the reconnect cursor as each seq'd delta is consumed, so a drop
      // resumes from exactly here (no missed or replayed bytes).
      if (
        cursor &&
        typeof parsed?.seq === 'number' &&
        parsed.seq > cursor.lastSeq
      ) {
        cursor.lastSeq = parsed.seq;
      }
      if (event === 'stdout') callbacks.onStdout?.(text);
      else callbacks.onStderr?.(text);
    } else if (event === 'result') {
      const parsed = parseData<SessionExecResult>(data);
      if (parsed) result = parsed;
    } else if (event === 'error') {
      const parsed = parseData<{ message?: string }>(data);
      throw new Error(parsed?.message ?? 'sandbox session exec stream error');
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      parseSseBlock(buf.slice(0, idx), handleEvent);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf('\n\n');
    }
  }
  if (result === null) {
    throw new Error('sandbox session exec stream ended without a result');
  }
  return result;
}

function parseSseBlock(
  block: string,
  handle: (event: string, data: string) => void,
): void {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6);
    // ': ' comment lines (keepalive) are ignored.
  }
  if (data) handle(event, data);
}

function parseData<T>(data: string): T | null {
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<unreadable>';
  }
}
