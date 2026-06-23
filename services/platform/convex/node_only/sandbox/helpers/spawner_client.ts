'use node';

// HTTP client for the sandbox spawner.
//
// HMAC-signs each request body with SANDBOX_TOKEN (mirrors services/sandbox/
// src/auth.ts). Spawner rejects unsigned or wrong-signed requests with 401.

import { createHash, createHmac } from 'node:crypto';

import {
  sandboxErrorCodeLiterals,
  sandboxPhaseEventLiterals,
  sandboxStepStatusLiterals,
  type SandboxErrorCode,
  type SandboxLanguage,
  type SandboxPhaseEvent,
  type SandboxStepResult,
} from '../../../sandbox/wire';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';

interface SandboxFileBody {
  path: string;
  /**
   * Internal Caddy URL the spawner GETs to fetch the file bytes. Platform
   * mints each URL via `ctx.storage.getUrl(storageId)` + `toSandboxStorageUrl()`
   * so the bytes never round-trip through the JSON request body — keeps the
   * wire binary-safe and unbounded by `maxRequestBodyBytes`. Mirrors
   * `services/sandbox/src/types.ts:SandboxFile.url`.
   */
  url: string;
}

interface SpawnerExecuteBody {
  executionId: string;
  organizationId: string;
  language: SandboxLanguage;
  /**
   * Files staged at /user/code/<path>. Required for both single-script
   * and multi-script modes. Mirrors `services/sandbox/src/types.ts:ExecuteRequest.files`.
   * The cross-service wire-shape stays in sync via this duplicated
   * declaration — any drift surfaces as a typecheck mismatch in the
   * platform `executeCode` action which constructs this body.
   */
  files: SandboxFileBody[];
  /**
   * Single-script mode: relative path inside `files[]` to exec. Mutually
   * exclusive with `steps`; the spawner rejects payloads where both (or
   * neither) are present.
   */
  entryPath?: string;
  /**
   * Multi-script mode body field. Paths in `files[]` that the spawner-
   * generated wrapper invokes sequentially in the same container. See
   * `services/sandbox/src/types.ts:ExecuteRequest.steps` for the full
   * contract.
   */
  steps?: string[];
  /**
   * Legacy single-bucket package list. Used for single-language requests
   * (`language: 'python' | 'node'`). Polyglot requests should use
   * {@link packagesByLang} instead so the spawner knows which install
   * tool to run for each bucket.
   */
  packages?: string[];
  /**
   * Per-runtime package buckets. Sent when `language === 'polyglot'` to
   * route installs to `uv pip install` (python) and / or `npm install`
   * (node) independently. Either bucket may be omitted; an empty or
   * absent bucket means "skip that install".
   */
  packagesByLang?: {
    python?: string[];
    node?: string[];
  };
  timeoutMs?: number;
  /**
   * Step-scoped environment variables injected into the runtime process.
   * Mirrors `services/sandbox/src/types.ts:ExecuteRequest.env`. Already
   * resolved/templated by the workflow engine; the spawner sanitizes it
   * (drops reserved names + over-cap entries) before merging into the
   * launch env. Only the deterministic-script workflow path populates this
   * today; the run_code LLM tool never sets it.
   */
  env?: Record<string, string>;
  /**
   * Prior-run output downloads. Each entry carries a name (filename to
   * write inside /user/output/) and a URL the spawner GETs to pull
   * the bytes. URLs are pre-rewritten through `toSandboxStorageUrl()` so
   * they target the internal Caddy alias (`http://proxy/...`) and never
   * have to round-trip through the public hostname. Replaces the legacy
   * inline-base64 `priorOutputFiles[]` field — see plan §1.
   */
  priorOutputDownloads?: Array<{ name: string; url: string }>;
  /**
   * User-upload downloads. Each entry's bytes are fetched by the spawner
   * and written to `/user/uploads/<name>`. Separate from
   * `priorOutputDownloads` so the agent reads user-uploaded raw assets
   * from a dedicated dir, never confused with files produced by previous
   * `run_code` invocations.
   */
  userUploadDownloads?: Array<{ name: string; url: string }>;
  /**
   * Pre-allocated upload slots the spawner POSTs harvested output files
   * to. Length = N (defaults to 2; see plan §3). When the spawner needs
   * more slots than were pre-allocated it lazily requests additional
   * URLs via {@link outputUrlEndpoint}.
   */
  outputUploadSlots: Array<{ url: string }>;
  /**
   * HMAC-signed callback the spawner POSTs to when it needs more upload
   * slots than the pre-allocated pool. Server-side per-run quota counter
   * gates how many can be granted; see plan §3.
   */
  outputUrlEndpoint: string;
  /**
   * HMAC-signed callback the spawner POSTs to AFTER each output upload
   * succeeds. The platform records `{fileName, storageId, size,
   * contentType}` against the audit row's `uploadedStorageIds` set so a
   * spawner crash mid-harvest doesn't orphan blobs. See plan §3.
   */
  reportUploadedEndpoint: string;
}

interface SpawnerExecuteResponse {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  errorCode?: SandboxErrorCode;
  errorMessage?: string;
  stdoutBase64: string;
  stderrBase64: string;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  outputFiles: {
    name: string;
    /**
     * Convex `_storage` id. Replaces the legacy `contentBase64` field —
     * the spawner now POSTs bytes directly to a pre-signed upload URL and
     * returns the storageId Convex allocated. See plan §3.
     */
    storageId: string;
    size: number;
    contentType: string;
    /**
     * sha256 (hex) of the harvested bytes — populated by the spawner
     * during `harvestOutputDir` (crispy-curry plan §1). Used to seed the
     * cumulative `artifactOutputs` manifest entry for the next pre-stage
     * attestation. Required (parity-guarded by `HarvestOutputFile` in
     * `services/platform/convex/sandbox/wire.ts`); the SSE parser rejects
     * payloads missing it so a wire-drift surfaces as a hard failure
     * rather than a silently-undefined sha256 downstream.
     */
    sha256: string;
  }[];
  /** Per-step results populated only for multi-step requests. */
  steps?: SandboxStepResult[];
  /**
   * Optional upload telemetry. Older spawner images (built before the
   * presigned-URL plan landed) will omit this; new ones populate it with
   * attempted / succeeded counts plus per-failure detail. Treat as a
   * diagnostic — not a correctness signal.
   */
  uploadStats?: {
    attempted: number;
    succeeded: number;
    failures: Array<{
      slotIndex: number;
      fileName: string;
      httpStatus: number;
      errorSnippet: string;
    }>;
  };
  /**
   * Optional per-phase timing breakdown (ms). Helpful for tracking where
   * the round-trip budget goes; surface to audit so we can compare TTL
   * pressure vs the 1h `generateUploadUrl` window.
   */
  timing?: {
    stageMs: number;
    executeMs: number;
    harvestMs: number;
    uploadMs: number;
  };
  /**
   * Pre-stage attestation (crispy-curry plan §3). For every entry in
   * `priorOutputDownloads` the spawner reports back whether it landed on
   * `/user/output/` (`staged[]`) or was skipped (`skipped[]` with a
   * structured reason). The action diffs `staged[]` against the manifest
   * it sent and aborts the run with `PRE_STAGE_FAILED` if any expected
   * file is missing — BEFORE the spawner's outputFiles are promoted to
   * fileMetadata. Omitted when the request had no `priorOutputDownloads`.
   */
  priorStage?: {
    staged: Array<{ name: string; bytes: number; sha256: string }>;
    skipped: Array<{
      name: string;
      reason:
        | 'unsafe_path'
        | 'fetch_failed'
        | 'http_error'
        | 'url_expired'
        | 'write_failed';
      detail: string;
    }>;
  };
}

const SANDBOX_ERROR_CODE_SET: ReadonlySet<string> = new Set(
  sandboxErrorCodeLiterals,
);
const SANDBOX_PHASE_SET: ReadonlySet<string> = new Set(
  sandboxPhaseEventLiterals,
);
const SANDBOX_STEP_STATUS_SET: ReadonlySet<string> = new Set(
  sandboxStepStatusLiterals,
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

function spawnerBaseUrl(): string {
  // Default to host loopback so `bun dev`'s local convex-local-backend
  // (running on the host) can reach the spawner via the published port.
  // Docker compose sets
  // SANDBOX_URL=http://sandbox:8003 on the tale-convex container so the
  // dockerized convex resolves through Docker DNS instead. In blue-green
  // mode `sandbox` is the bare alias that the deploy flip points at the
  // ACTIVE colour — so new executions always reach the live spawner.
  return process.env.SANDBOX_URL ?? 'http://localhost:8003';
}

/**
 * Resolve the spawner URL for a SPECIFIC blue-green colour — used by cancel /
 * session ops so they reach the exact colour an execution started on, even
 * after a flip moved the bare `sandbox` alias to the new colour. `null`/empty
 * colour (single-colour mode, or the docker DNS host isn't `sandbox`) falls
 * back to the base URL.
 */
export function spawnerUrlForColor(color: string | null | undefined): string {
  const base = spawnerBaseUrl();
  if (!color) return base;
  try {
    const u = new URL(base);
    if (u.hostname !== 'sandbox') return base; // dev/loopback → no per-colour host
    return `${u.protocol}//sandbox-${color}:${u.port || '8003'}`;
  } catch {
    return base;
  }
}

function getSpawnerToken(): string | null {
  // Opt-in HMAC: when SANDBOX_TOKEN is unset (or empty/whitespace-only) the
  // spawner skips signature verification and this client sends unsigned
  // requests. `tale deploy` auto-mints one via ensure-env for production
  // deploys. Both sides .trim() and treat empty/whitespace as unset, so a
  // padded value can't derive a mismatched HMAC key.
  const token = process.env.SANDBOX_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

interface SpawnerExecuteCallbacks {
  /** Fired as soon as the runtime entrypoint emits a PHASE marker. */
  onPhase?: (phase: SandboxPhaseEvent) => Promise<void> | void;
  /**
   * Live stdout tail. Fires per spawner-side line (PHASE markers stripped).
   * The trailing newline is preserved. Used by the action to append to the
   * canvas's `runStdoutPreview` so users see output stream during the run
   * instead of only at terminal time. The action coalesces several
   * invocations into a single mutation per ~250 ms (or threshold bytes).
   */
  onStdout?: (text: string) => void;
  /** Live stderr tail. Fires per spawner-side chunk (not line-buffered). */
  onStderr?: (text: string) => void;
  /**
   * Fired once, as soon as the spawner's response headers arrive, with the
   * blue-green colour it reported via `X-Sandbox-Color` (or `null` in
   * single-colour mode). The action persists it on the execution row BEFORE
   * the body streams, so a concurrent user-Stop routes its cancel to the SAME
   * colour even after a deploy flip.
   */
  onSpawnerColor?: (color: string | null) => Promise<void> | void;
}

// How many times to re-POST /v1/execute when the spawner answers 503 "draining"
// (it's mid-flip and refusing new work). A handful of fast retries re-resolves
// the `sandbox` DNS alias onto the freshly-active colour. Bounded so a genuinely
// down tier still fails fast into SPAWNER_UNAVAILABLE.
const DRAIN_RETRY_MAX = 5;
const DRAIN_RETRY_DELAY_MS = 400;

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
// Spawner overhead budget above the user-code timeout: container pull/start,
// pip/npm install streaming, harvest + bytes-out. Keeps the fetch ceiling
// above the spawner-side wall clock so a healthy long run isn't aborted by
// the client. Anything beyond this is genuinely stuck (the SSE stream has
// stalled past any plausible processing), so abort and let the caller route
// through `failExecution` → `SPAWNER_UNAVAILABLE` rather than wait for the
// 30-min Convex action ceiling.
const SPAWNER_FETCH_OVERHEAD_MS = 60_000;
const SPAWNER_DEFAULT_TIMEOUT_MS = 30_000;

export async function spawnerExecute(
  body: SpawnerExecuteBody,
  signal: AbortSignal,
  callbacks: SpawnerExecuteCallbacks = {},
): Promise<SpawnerExecuteResponse> {
  const baseUrl = spawnerBaseUrl();
  const url = `${baseUrl}/v1/execute`;
  const path = new URL(url).pathname;
  const token = getSpawnerToken();
  const bodyJson = JSON.stringify(body);

  // Re-signed per attempt: each retry needs a fresh timestamp within the
  // spawner's clock-skew tolerance.
  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    };
    if (token !== null) {
      const timestamp = String(Date.now());
      headers[SIGNATURE_HEADER] = signRequest(
        'POST',
        path,
        timestamp,
        bodyJson,
        token,
      );
      headers[TIMESTAMP_HEADER] = timestamp;
    }
    return headers;
  };

  // Independent client-side timeout. Without this a stalled SSE stream
  // (network or spawner hang) would block the Convex action until its 30-min
  // hard limit, wasting the slot. Combine with the caller's abort signal so
  // user-stop still aborts immediately.
  const fetchTimeoutMs =
    (body.timeoutMs ?? SPAWNER_DEFAULT_TIMEOUT_MS) + SPAWNER_FETCH_OVERHEAD_MS;

  // Fetch with blue-green drain-retry: a 503 "draining" means the targeted
  // colour is mid-flip; re-POST so the `sandbox` alias re-resolves onto the
  // now-active colour. Other statuses are handled below.
  const doFetch = async (): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const fetchAbort = AbortSignal.any([
        signal,
        AbortSignal.timeout(fetchTimeoutMs),
      ]);
      let r: Response;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: buildHeaders(),
          body: bodyJson,
          signal: fetchAbort,
        });
      } catch (err) {
        throw new Error(
          `sandbox spawner unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      if (r.status === 503 && attempt < DRAIN_RETRY_MAX) {
        const peek = await r.text().catch(() => '');
        if (peek.includes('draining')) {
          await new Promise((resolve) =>
            setTimeout(resolve, DRAIN_RETRY_DELAY_MS),
          );
          continue;
        }
        throw new Error(`sandbox spawner 503: ${peek || r.statusText}`);
      }
      return r;
    }
  };

  const res = await doFetch();

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

  // Blue-green: report the colour the spawner self-identified (X-Sandbox-Color)
  // so the caller can persist it on the execution row BEFORE streaming begins —
  // a concurrent user-Stop then routes its cancel to this exact colour.
  if (callbacks.onSpawnerColor) {
    const reported = res.headers.get('x-sandbox-color');
    try {
      await callbacks.onSpawnerColor(
        reported && reported.length > 0 ? reported : null,
      );
    } catch (err) {
      console.warn(`[spawnerExecute] onSpawnerColor callback failed:`, err);
    }
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
            await callbacks.onPhase(rawPhase as SandboxPhaseEvent);
          } catch (err) {
            // Log but don't abort the underlying execution — the artifact
            // patch is a UX nice-to-have; the audit + final result still
            // proceed to completion.
            console.warn(`[spawnerExecute] onPhase callback failed:`, err);
          }
        }
      } else if (parsed.event === 'stdout') {
        const text = parsed.data.text;
        if (typeof text === 'string' && text.length > 0 && callbacks.onStdout) {
          try {
            callbacks.onStdout(text);
          } catch (err) {
            // Same posture as `onPhase`: log but don't abort the run — live
            // tail is a UX-enhancement, not a correctness contract. The
            // final `result` event still carries the canonical base64'd
            // stdout/stderr buffer.
            console.warn(`[spawnerExecute] onStdout callback failed:`, err);
          }
        }
      } else if (parsed.event === 'stderr') {
        const text = parsed.data.text;
        if (typeof text === 'string' && text.length > 0 && callbacks.onStderr) {
          try {
            callbacks.onStderr(text);
          } catch (err) {
            console.warn(`[spawnerExecute] onStderr callback failed:`, err);
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
  // Each outputFile must now carry a Convex storageId (the spawner POSTed
  // the bytes to a pre-signed upload URL during harvest). The legacy
  // `contentBase64` shape was retired by the sandbox-wobbly-origami plan.
  for (const f of raw.outputFiles) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked via guards above; standard wire-shape narrowing pattern
    const e = f as Record<string, unknown>;
    if (typeof e.name !== 'string') return null;
    if (typeof e.storageId !== 'string' || e.storageId.length === 0) {
      return null;
    }
    if (typeof e.size !== 'number') return null;
    if (typeof e.contentType !== 'string') return null;
    // sha256 required (parity-guarded by `HarvestOutputFile` in wire.ts).
    // Reject malformed payloads here so the downstream insert can write
    // the hash without ambiguity.
    if (typeof e.sha256 !== 'string' || e.sha256.length === 0) return null;
  }
  // steps is optional, but if present must be a typed array of step
  // results — refuse the payload otherwise so a wire-drift surfaces as
  // a hard failure rather than a silently-typecast garbage object.
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps)) return null;
    for (const s of raw.steps) {
      if (s === null || typeof s !== 'object' || Array.isArray(s)) return null;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked via guards above; standard wire-shape narrowing pattern used elsewhere in this file (see `parseSseEvent`).
      const e = s as Record<string, unknown>;
      if (typeof e.path !== 'string') return null;
      if (
        typeof e.status !== 'string' ||
        !SANDBOX_STEP_STATUS_SET.has(e.status)
      ) {
        return null;
      }
      if (e.exitCode !== null && typeof e.exitCode !== 'number') return null;
      if (typeof e.durationMs !== 'number') return null;
    }
  }
  // uploadStats / timing are optional diagnostic fields. If present they
  // must be well-formed objects so a wire-drift surfaces as a hard fail
  // rather than a silently-typecast garbage object.
  if (raw.uploadStats !== undefined) {
    if (
      raw.uploadStats === null ||
      typeof raw.uploadStats !== 'object' ||
      Array.isArray(raw.uploadStats)
    ) {
      return null;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above
    const us = raw.uploadStats as Record<string, unknown>;
    if (typeof us.attempted !== 'number') return null;
    if (typeof us.succeeded !== 'number') return null;
    if (!Array.isArray(us.failures)) return null;
    for (const f of us.failures) {
      if (f === null || typeof f !== 'object' || Array.isArray(f)) return null;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above
      const fe = f as Record<string, unknown>;
      if (typeof fe.slotIndex !== 'number') return null;
      if (typeof fe.fileName !== 'string') return null;
      if (typeof fe.httpStatus !== 'number') return null;
      if (typeof fe.errorSnippet !== 'string') return null;
    }
  }
  if (raw.timing !== undefined) {
    if (
      raw.timing === null ||
      typeof raw.timing !== 'object' ||
      Array.isArray(raw.timing)
    ) {
      return null;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above
    const t = raw.timing as Record<string, unknown>;
    if (typeof t.stageMs !== 'number') return null;
    if (typeof t.executeMs !== 'number') return null;
    if (typeof t.harvestMs !== 'number') return null;
    if (typeof t.uploadMs !== 'number') return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape-checked above; remaining nullable fields default at caller
  return raw as unknown as SpawnerExecuteResponse;
}

export async function spawnerCancel(
  executionId: string,
  spawnerColor?: string | null,
): Promise<void> {
  // Route to the SAME colour the execution started on (persisted on the row),
  // so a cancel still lands after a deploy flip moved the bare `sandbox` alias.
  const url = `${spawnerUrlForColor(spawnerColor)}/v1/cancel/${encodeURIComponent(executionId)}`;
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
    // 5s timeout: cancel is best-effort and the watchdog reaps stuck rows
    // anyway. Without this, an unreachable spawner blocks user-Stop per row
    // until Node's socket default (~minutes) — visible to users as the
    // canvas spinner refusing to clear.
    await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(5_000),
    });
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
