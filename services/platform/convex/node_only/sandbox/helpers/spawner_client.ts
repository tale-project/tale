'use node';

// HTTP client for the sandbox spawner.
//
// HMAC-signs each request body with SANDBOX_TOKEN (mirrors services/sandbox/
// src/auth.ts). Spawner rejects unsigned or wrong-signed requests with 401.

import { createHash, createHmac } from 'node:crypto';

import {
  sandboxErrorCodeLiterals,
  sandboxPhaseEventLiterals,
  type SandboxErrorCode,
  type SandboxLanguage,
  type SandboxPhaseEvent,
} from '../../../sandbox/wire';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

export interface SpawnerExecuteBody {
  executionId: string;
  organizationId: string;
  language: SandboxLanguage;
  code: string;
  packages?: string[];
  timeoutMs?: number;
  options?: { allowSdist?: boolean; allowInstallScripts?: boolean };
}

// Re-exported for callers that already imported these via this module.
// `SandboxErrorCode` is the canonical name; `SpawnerErrorCode` kept as a
// transitional alias.
export type SpawnerErrorCode = SandboxErrorCode;
export type SpawnerPhase = SandboxPhaseEvent;

export interface SpawnerExecuteResponse {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: SpawnerErrorCode;
  errorMessage?: string;
  stdoutBase64: string;
  stderrBase64: string;
  durationMs: number;
  installMs: number | null;
  runMs: number | null;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  outputFiles: {
    name: string;
    contentBase64: string;
    size: number;
    contentType: string;
  }[];
}

const SANDBOX_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  sandboxErrorCodeLiterals,
);
const SANDBOX_PHASE_SET: ReadonlySet<string> = new Set(
  sandboxPhaseEventLiterals,
);

// Signature contract (mirrors services/sandbox/src/auth.ts):
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(token, signedString)
// Bundling method+path+ts into the signed string stops a captured
// /v1/execute signature from being replayed against /v1/cancel/:id and
// caps the replay window to the spawner's 60s clock-skew tolerance.
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
  // Mirrors RAG_URL / CRAWLER_URL convention: default to host loopback
  // so `bun dev`'s local convex-local-backend (running on the host) can
  // reach the spawner via the published port. Docker compose sets
  // SANDBOX_URL=http://sandbox:8003 on the tale-convex container so the
  // dockerized convex resolves through Docker DNS instead.
  return process.env.SANDBOX_URL ?? 'http://localhost:8003';
}

function getSpawnerToken(): string | null {
  // Optional only in dev (rag/crawler-parity, internal-trust mode). The
  // spawner refuses to start in production without a token unless
  // SANDBOX_ALLOW_UNAUTH=true; `tale deploy` auto-mints one via
  // ensure-env. Both sides treat empty-string as unset.
  const token = process.env.SANDBOX_TOKEN;
  return token && token.length > 0 ? token : null;
}

export interface SpawnerExecuteCallbacks {
  /** Fired as soon as the runtime entrypoint emits a PHASE marker. */
  onPhase?: (phase: SpawnerPhase) => Promise<void> | void;
}

/**
 * POST /v1/execute as SSE. The spawner emits zero or more `event: phase`
 * lines followed by exactly one `event: result` line. We invoke `onPhase`
 * per phase event and return the parsed result. The function is still
 * async-await — the streaming is internal.
 *
 * Throws on transport / 5xx / 401; returns the spawner's own
 * success-shape `{status, errorCode, ...}` otherwise so the caller can
 * decide failure semantics.
 */
export async function spawnerExecute(
  body: SpawnerExecuteBody,
  signal: AbortSignal,
  callbacks: SpawnerExecuteCallbacks = {},
): Promise<SpawnerExecuteResponse> {
  const baseUrl = getSpawnerUrl();
  const url = `${baseUrl}/v1/execute`;
  const path = new URL(url).pathname;
  const token = getSpawnerToken();
  const bodyJson = JSON.stringify(body);
  const timestamp = String(Date.now());

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  if (token !== null) {
    headers[SIGNATURE_HEADER] = signRequest(
      'POST',
      path,
      timestamp,
      bodyJson,
      token,
    );
    headers[TIMESTAMP_HEADER] = timestamp;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyJson,
      signal,
    });
  } catch (err) {
    throw new Error(
      `sandbox spawner unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (res.status === 401) {
    throw new Error(
      'sandbox spawner rejected request (401) — SANDBOX_TOKEN mismatch between Convex and spawner',
    );
  }
  if (res.status === 429) {
    throw new Error('sandbox spawner busy (429) — concurrency cap reached');
  }
  if (res.status === 413) {
    throw new Error(
      'sandbox spawner refused payload (413) — request body exceeds spawner cap',
    );
  }
  if (!res.ok) {
    const text = await res.text().catch((err) => {
      console.warn(`[spawnerExecute] failed to read error body:`, err);
      return '';
    });
    throw new Error(`sandbox spawner ${res.status}: ${text || res.statusText}`);
  }
  if (!res.body) {
    throw new Error('sandbox spawner returned no body');
  }

  // SSE parser: events are separated by `\n\n`; each event has `event:` and
  // `data:` lines. Handles CRLF line endings (any future proxy) as well as
  // LF. Accumulates text and processes complete events as they arrive,
  // dispatching phase callbacks and capturing the final result.
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let finalResult: SpawnerExecuteResponse | null = null;
  let errorEvent: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary: number;
    while ((boundary = buf.indexOf('\n\n')) !== -1) {
      const eventText = buf.slice(0, boundary);
      buf = buf.slice(boundary + 2);
      const parsed = parseSseEvent(eventText);
      if (!parsed) continue;
      if (parsed.event === 'phase') {
        const rawPhase = parsed.data.phase;
        if (
          typeof rawPhase === 'string' &&
          SANDBOX_PHASE_SET.has(rawPhase) &&
          callbacks.onPhase
        ) {
          try {
            // SANDBOX_PHASE_SET.has(rawPhase) guard above narrows the
            // string into the literal union the callback expects, but
            // the lint rule still flags the assertion; suppress for the
            // wire-shape boundary.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            await callbacks.onPhase(rawPhase as SpawnerPhase);
          } catch (err) {
            // Log but don't abort the underlying execution — the artifact
            // patch is a UX nice-to-have; the audit + final result still
            // proceed to completion.
            console.warn(`[spawnerExecute] onPhase callback failed:`, err);
          }
        }
      } else if (parsed.event === 'result') {
        const validated = validateExecuteResponse(parsed.data);
        if (validated) {
          finalResult = validated;
        } else {
          throw new Error('sandbox spawner result event has malformed payload');
        }
      } else if (parsed.event === 'error') {
        const rawMessage = parsed.data.message;
        errorEvent =
          typeof rawMessage === 'string' && rawMessage.length > 0
            ? rawMessage
            : 'sandbox spawner error';
      }
    }
  }

  if (errorEvent !== null) {
    throw new Error(`sandbox spawner SSE error: ${errorEvent}`);
  }
  if (finalResult === null) {
    throw new Error('sandbox spawner stream ended without a result event');
  }
  return finalResult;
}

function parseSseEvent(
  block: string,
): { event: string; data: Record<string, unknown> } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const raw of block.split('\n')) {
    if (raw.startsWith('event:')) {
      event = raw.slice(6).trim();
    } else if (raw.startsWith('data:')) {
      dataLines.push(raw.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join('\n'));
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wire JSON; the object guard above rules out null/array, so indexing string keys is sound
    return { event, data: parsed as Record<string, unknown> };
  } catch (err) {
    console.warn(`[spawnerExecute] SSE event parse failed:`, err);
    return null;
  }
}

/**
 * Narrow the result event payload to `SpawnerExecuteResponse`. Returns
 * null on shape mismatch — caller throws so the action fails through the
 * normal failExecution path rather than producing partial state.
 */
function validateExecuteResponse(
  raw: Record<string, unknown>,
): SpawnerExecuteResponse | null {
  if (
    raw.status !== 'completed' &&
    raw.status !== 'failed' &&
    raw.status !== 'cancelled'
  ) {
    return null;
  }
  if (
    raw.errorCode !== undefined &&
    (typeof raw.errorCode !== 'string' ||
      !SANDBOX_ERROR_CODE_SET.has(raw.errorCode))
  ) {
    return null;
  }
  if (
    typeof raw.stdoutBase64 !== 'string' ||
    typeof raw.stderrBase64 !== 'string'
  ) {
    return null;
  }
  if (typeof raw.durationMs !== 'number') return null;
  if (!Array.isArray(raw.outputFiles)) return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above; remaining nullable fields default at caller
  return raw as unknown as SpawnerExecuteResponse;
}

export async function spawnerCancel(executionId: string): Promise<void> {
  const url = `${getSpawnerUrl()}/v1/cancel/${encodeURIComponent(executionId)}`;
  const path = new URL(url).pathname;
  const token = getSpawnerToken();
  const body = '';
  const timestamp = String(Date.now());
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token !== null) {
    headers[SIGNATURE_HEADER] = signRequest(
      'POST',
      path,
      timestamp,
      body,
      token,
    );
    headers[TIMESTAMP_HEADER] = timestamp;
  }
  try {
    await fetch(url, { method: 'POST', headers, body });
  } catch (err) {
    // Cancellation is best-effort; the watchdog cron will reap stuck rows
    // if the spawner is unreachable. Log so a stuck cancel path isn't
    // silently swallowed.
    console.warn(
      `[spawnerCancel] best-effort cancel failed for ${executionId}:`,
      err,
    );
  }
}
