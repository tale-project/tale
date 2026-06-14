// runnerd wire protocol — MIRROR of
// services/sandbox/src/session/runnerd-protocol.ts (the canonical source).
//
// The daemon is bundled into the runtime image and cannot import across
// service boundaries (same convention as wire.ts ↔ convex/sandbox/wire.ts).
// Keep this in sync with the canonical file; protocol.test.ts pins the shapes.

export const RUNNERD_PORT = 8200;
export const RUNNERD_TOKEN_HEADER = 'x-tale-runnerd-token';
export const RUNNERD_TOKEN_CONTEXT = 'runnerd-v1:';

export const RUNNERD_MAX_LIVE_EXECS = 4;
export const RUNNERD_RING_BUFFER_BYTES = 256 * 1024;
/** Per-consumer in-flight write ceiling. A slow/stalled (but still attached)
 * SSE consumer would otherwise let Node buffer un-drained stdout in the HTTP
 * response unboundedly — the only thing the old fixed stdout cap incidentally
 * bounded. Past this, the daemon stops writing to that ONE consumer (the others
 * are unaffected); it reconnects via /attach?sinceSeq= and replays from the
 * bounded ring. Not a stream cap — it bounds memory, never truncates output. */
export const RUNNERD_CONSUMER_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
export const RUNNERD_ENV_MAX_ENTRIES = 128;
export const RUNNERD_ENV_MAX_VALUE_BYTES = 32 * 1024;

export const RUNNERD_ENV_DENYLIST = ['HOME', 'PATH', 'TMPDIR'] as const;
export const RUNNERD_ENV_DENY_PREFIXES = ['TALE_RUNNERD_'] as const;
export const RUNNERD_ENV_DENY_PROXY_RE = /^(https?|no)_proxy$/i;

export function isDeniedEnvName(name: string): boolean {
  if ((RUNNERD_ENV_DENYLIST as readonly string[]).includes(name)) return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name)) return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => name.startsWith(p));
}

export interface RunnerdHealth {
  ok: true;
  bootedAtMs: number;
  lastActivityAtMs: number;
  liveExecs: number;
}

export interface RunnerdExecRequest {
  execId: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdinBase64?: string;
  /** 'hold' keeps the child's stdin open after writing stdinBase64 so the
   * caller can push further NDJSON lines via POST /execs/:id/stdin (Claude
   * Code --input-format stream-json). Default 'close' = write-then-end. */
  stdinMode?: 'close' | 'hold';
  timeoutMs: number;
  /** Cumulative stdout truncation cap. `<= 0` means UNLIMITED — the live stream
   * is never truncated and memory stays bounded by the ring (+ the per-consumer
   * buffer ceiling). One-shot collected execs pass a positive cap to bound the
   * response; long-lived streaming execs (the agent) pass 0. */
  stdoutMaxBytes: number;
  /** Cumulative stderr truncation cap. `<= 0` means UNLIMITED (see above). */
  stderrMaxBytes: number;
}

/** Cap on one decoded stdin line. Steer batches are hook-capped at 16 KB; the
 * headroom covers JSON envelope + base64 slack without permitting floods. */
export const RUNNERD_STDIN_MAX_BYTES = 64 * 1024;

export interface RunnerdStdinWriteRequest {
  /** Base64 bytes appended to the held-open stdin. The decoded bytes must be
   * exactly one newline-terminated valid-JSON line: Claude Code's stream-json
   * reader exits the whole process on a malformed line (verified 2.1.173), so
   * the daemon fail-closes instead of forwarding garbage. Optional when `eof`
   * alone closes the pipe. */
  b64?: string;
  /** Close stdin after writing — the stream-json CLI exits shortly after EOF
   * (and abandons any background tasks it still tracks). */
  eof?: boolean;
}

export interface RunnerdStdinWriteResponse {
  ok: boolean;
  /** NOT_FOUND: exec not live. STDIN_CLOSED: exec spawned in 'close' mode or
   * EOF already sent. BAD_LINE: payload failed the single-NDJSON-line check
   * (or exceeded RUNNERD_STDIN_MAX_BYTES). WRITE_FAILED: pipe write threw. */
  reason?: 'NOT_FOUND' | 'STDIN_CLOSED' | 'BAD_LINE' | 'WRITE_FAILED';
}

export type RunnerdExecEvent = (
  | { t: 'start'; execId: string; startedAtMs: number }
  | { t: 'stdout'; b64: string }
  | { t: 'stderr'; b64: string }
  | {
      t: 'exit';
      exitCode: number;
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean };
      timedOut: boolean;
      cancelled: boolean;
    }
  | {
      t: 'fail';
      code: 'INVALID_CWD' | 'EXEC_LIMIT' | 'DUPLICATE_EXEC' | 'BAD_REQUEST';
      message: string;
    }
) & { seq?: number };

export interface RunnerdCancelResponse {
  killed: boolean;
}

/** GET /execs/:id — per-exec status without consuming the stream.
 * `running` (live) carries startedAtMs; `exited` (recently retained) carries
 * the real exitCode; `gone` (evicted past the recent window / never existed)
 * is surfaced as HTTP 404. */
export interface RunnerdExecStatus {
  execId: string;
  state: 'running' | 'exited' | 'gone';
  startedAtMs?: number;
  exitCode?: number | null;
}

export interface RunnerdEnvPatch {
  set?: Record<string, string>;
  unset?: string[];
}

export interface RunnerdEnvResponse {
  ok: true;
  denied: string[];
}

export interface RunnerdError {
  error: string;
  message?: string;
}

export const WORKSPACE_ROOT = '/workspace';
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;
