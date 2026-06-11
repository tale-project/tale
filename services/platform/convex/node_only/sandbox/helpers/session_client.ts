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
): Promise<SessionExecResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec`;
  const bodyJson = JSON.stringify(body);
  const fetchAbort = AbortSignal.any([
    signal,
    AbortSignal.timeout((body.timeoutMs ?? 600_000) + 60_000),
  ]);
  const res = await fetch(`${getSpawnerUrl()}${path}`, {
    method: 'POST',
    headers: signedHeaders('POST', path, bodyJson, 'text/event-stream'),
    body: bodyJson,
    signal: fetchAbort,
  });
  if (res.status === 404) throw new Error(`session ${sessionId} not found`);
  if (!res.ok || !res.body) {
    throw new Error(`sandbox session exec failed (${res.status})`);
  }
  return consumeExecSse(res.body, callbacks);
}

async function consumeExecSse(
  body: ReadableStream<Uint8Array>,
  callbacks: SessionExecCallbacks,
): Promise<SessionExecResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let result: SessionExecResult | null = null;
  const handleEvent = (event: string, data: string): void => {
    if (event === 'stdout' || event === 'stderr') {
      const parsed = parseData<{ text?: string }>(data);
      const text = parsed?.text ?? '';
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
