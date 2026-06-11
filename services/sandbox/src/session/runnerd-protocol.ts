// runnerd wire protocol — CANONICAL SOURCE OF TRUTH.
//
// runnerd is the in-container control daemon for persistent sessions (PID 1
// of the session container, listening on :8200 inside tale-sandbox-net). The
// spawner is its only legitimate client; every request carries the
// per-session token in `x-tale-runnerd-token` (see deriveRunnerdToken in
// session/runnerd-client.ts: HMAC-SHA256(SANDBOX_TOKEN, "runnerd-v1:" +
// sessionId), so any spawner replica can address any session statelessly).
//
// This file is mirrored by `services/sandbox-runtime/daemon/src/protocol.ts`
// — the daemon is bundled into the runtime image and cannot import across
// service boundaries (same convention as wire.ts ↔ convex/sandbox/wire.ts).
// Keep both files in sync; the daemon's unit tests snapshot the JSON shapes.
//
// Transport notes:
//  - POST /execs responds with NDJSON (one JSON object per line, flushed per
//    event). The spawner translates NDJSON → SSE for the platform. NDJSON
//    (not SSE) daemon-side keeps the in-container parser trivial and makes
//    the ring-buffer replay path byte-identical to the live path.
//  - stdout/stderr ride as base64 chunks: the bytes must survive the hop
//    UNALTERED and in order (agent adapters parse JSONL from stdout; any
//    re-encoding or line-merging corrupts mid-line chunk boundaries).

export const RUNNERD_PORT = 8200;
export const RUNNERD_TOKEN_HEADER = 'x-tale-runnerd-token';

/** Prefix bound into the per-session token derivation. Versioned so a future
 * protocol break can rotate every session token by bumping the string. */
export const RUNNERD_TOKEN_CONTEXT = 'runnerd-v1:';

// Caps enforced daemon-side (the spawner also validates request-side; the
// daemon re-enforces so a compromised spawner replica can't wedge a session).
export const RUNNERD_MAX_LIVE_EXECS = 4;
export const RUNNERD_RING_BUFFER_BYTES = 256 * 1024;
export const RUNNERD_ENV_MAX_ENTRIES = 128;
export const RUNNERD_ENV_MAX_VALUE_BYTES = 32 * 1024;

/**
 * Env names the daemon refuses to set/unset/overlay — these carry the
 * sandbox plumbing (egress proxy, workspace-home, daemon auth). Checked as
 * exact names except the two prefix rules.
 */
export const RUNNERD_ENV_DENYLIST = ['HOME', 'PATH', 'TMPDIR'] as const;
export const RUNNERD_ENV_DENY_PREFIXES = ['TALE_RUNNERD_'] as const;
/** Proxy vars are deny-listed case-insensitively (HTTP_PROXY/http_proxy…). */
export const RUNNERD_ENV_DENY_PROXY_RE = /^(https?|no)_proxy$/i;

export function isDeniedEnvName(name: string): boolean {
  if ((RUNNERD_ENV_DENYLIST as readonly string[]).includes(name)) return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name)) return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

// --- GET /healthz ----------------------------------------------------------

export interface RunnerdHealth {
  ok: true;
  bootedAtMs: number;
  /** Daemon-held activity clock: last exec start/exit, env change, or file
   * op. The spawner's idle reaper reads this, so idleness stays correct
   * across spawner restarts. */
  lastActivityAtMs: number;
  liveExecs: number;
}

// --- POST /execs (NDJSON response stream) ----------------------------------

export interface RunnerdExecRequest {
  /** ID_ALPHABET_RE; unique within the session (daemon 409s duplicates). */
  execId: string;
  /** argv form — spawned directly, no shell. Mutually exclusive with shell. */
  command?: string[];
  /** shell form — runs via `bash -lc` so login-shell env (PATH exports from
   * the entrypoint) applies. Mutually exclusive with command. */
  shell?: string;
  /** Absolute (or /workspace-relative) cwd; realpath must stay under
   * /workspace and exist — INVALID_CWD otherwise, no silent mkdir. */
  cwd?: string;
  /** Per-exec overlay on the session env store (deny-list enforced). */
  env?: Record<string, string>;
  /** Base64 bytes written to the child's stdin, which is then closed.
   * Prompts ride here (never argv — process lists leak argv). */
  stdinBase64?: string;
  timeoutMs: number;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
}

/** NDJSON lines emitted while an exec runs. Exactly one terminal `exit` or
 * `fail` line closes the stream; `stdout`/`stderr` chunks are base64 and
 * preserve byte order within their own stream. */
export type RunnerdExecEvent =
  | { t: 'start'; execId: string; startedAtMs: number }
  | { t: 'stdout'; b64: string }
  | { t: 'stderr'; b64: string }
  | {
      t: 'exit';
      exitCode: number;
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean };
      /** Set when the daemon killed the process group at timeoutMs. */
      timedOut: boolean;
      /** Set when a cancel landed before exit. */
      cancelled: boolean;
    }
  | {
      t: 'fail';
      /** Structured pre-spawn failures (the process never ran). */
      code: 'INVALID_CWD' | 'EXEC_LIMIT' | 'DUPLICATE_EXEC' | 'BAD_REQUEST';
      message: string;
    };

// --- POST /execs/:id/cancel --------------------------------------------------

export interface RunnerdCancelResponse {
  /** True when a live process group received the SIGTERM→SIGKILL ladder. */
  killed: boolean;
}

// --- GET /execs/:id ----------------------------------------------------------

export interface RunnerdExecStatus {
  execId: string;
  state: 'running' | 'exited';
  startedAtMs: number;
  exitCode: number | null;
}

// --- POST /env ---------------------------------------------------------------

export interface RunnerdEnvPatch {
  set?: Record<string, string>;
  unset?: string[];
}

export interface RunnerdEnvResponse {
  ok: true;
  /** Names rejected by the deny-list (reported, not fatal — the caller
   * decides whether a partial apply is acceptable). */
  denied: string[];
}

// --- error envelope ----------------------------------------------------------

/** Non-2xx JSON body for every endpoint. */
export interface RunnerdError {
  error: string;
  message?: string;
}
