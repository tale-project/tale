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
/** Per-consumer in-flight write ceiling. A slow/stalled (but still attached)
 * SSE consumer would otherwise let Node buffer un-drained stdout in the HTTP
 * response unboundedly — the only thing the old fixed stdout cap incidentally
 * bounded. Past this, the daemon disconnects that ONE consumer (the others
 * are unaffected); it reconnects via /attach?sinceSeq= and replays from the
 * disk-backed journal. */
export const RUNNERD_CONSUMER_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
/** Cap on ONE request body runnerd accepts, on every route. The spawner's own
 * SANDBOX_MAX_REQUEST_BODY_BYTES is clamped to this at boot, so a stage batch
 * the spawner accepted (inline base64 content for a skill bundle chunk) can
 * never be refused here as oversize; over it runnerd answers 413
 * payload_too_large, never a misleading 400 bad_request. */
export const RUNNERD_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
export const RUNNERD_ENV_MAX_ENTRIES = 128;
export const RUNNERD_ENV_MAX_VALUE_BYTES = 32 * 1024;

export const RUNNERD_ENV_DENYLIST = [
  'HOME',
  'PATH',
  'TMPDIR',
  'TALE_BUILDKIT_NETWORK_SUBNETS',
  'TALE_DIND_INNER_POOL',
  'TALE_DIND_INNER_BIP',
  'TALE_DIND_INNER_POOL_OVERRIDE',
] as const;
export const RUNNERD_ENV_DENY_PREFIXES = ['TALE_RUNNERD_'] as const;
export const RUNNERD_ENV_DENY_PROXY_RE = /^(https?|no)_proxy$/i;

export function isDeniedEnvName(name: string): boolean {
  // Case-insensitive (mirrors services/sandbox/src/session/runnerd-protocol.ts):
  // a lowercase variant of a reserved name must not slip past the deny-list.
  const upper = name.toUpperCase();
  if (RUNNERD_ENV_DENYLIST.some((v) => v === upper)) return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name)) return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => upper.startsWith(p));
}

export interface RunnerdHealth {
  ok: true;
  /** DinD capability readiness without activation. False blocks new work. */
  dockerReady?: boolean;
  /** Sustained probe failure or observed terminal Docker state; permits fenced idle recovery. */
  dockerRecoveryRequired?: boolean;
  bootedAtMs: number;
  lastActivityAtMs: number;
  liveExecs: number;
  /** Absent on older runtime images; pressure reclamation then fails closed. */
  activity?: {
    generation: string;
    activeOperations: number;
    released: boolean;
    pinned: boolean;
    reclaiming: boolean;
    /** Supports an atomic idle-clock cutoff even for an unreleased session. */
    idleReclaim?: boolean;
  };
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
  /** Cumulative stdout truncation cap; `<= 0` disables truncation. Journal
   * storage limits still end an exec with OUTPUT_LIMIT. In-memory diagnostic
   * output and consumer queues remain bounded. One-shot collected execs pass
   * a positive cap; long-lived streaming execs (the agent) pass 0. */
  stdoutMaxBytes: number;
  /** Cumulative stderr truncation cap; `<= 0` disables truncation (see above). */
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
   * (or exceeded RUNNERD_STDIN_MAX_BYTES). WRITE_FAILED: pipe write threw or
   * its bounded input queue is full. */
  reason?: 'NOT_FOUND' | 'STDIN_CLOSED' | 'BAD_LINE' | 'WRITE_FAILED';
}

export type RunnerdExecEvent = (
  | { t: 'start'; execId: string; startedAtMs: number }
  | { t: 'stdout'; b64: string }
  | { t: 'stderr'; b64: string }
  | { t: 'replay-start' }
  | { t: 'replay-complete'; throughSeq: number }
  | {
      t: 'exit';
      exitCode: number;
      /**
       * CANONICAL execution wall-clock: measured by the daemon itself, from
       * immediately before `spawn()` (the `start` event's `startedAtMs`) to
       * the child's exit with all stdio drained. Excludes everything outside
       * the process — container/Pod scheduling, image pull, session startup,
       * endpoint resolution, input staging, output harvest — so it is
       * identical on the docker and kubernetes backends, which host the same
       * daemon. Consumers (the spawner's `SessionExecResponse.durationMs`,
       * usage analytics) forward this value verbatim.
       */
      durationMs: number;
      truncated: { stdout: boolean; stderr: boolean };
      timedOut: boolean;
      cancelled: boolean;
    }
  | {
      t: 'fail';
      code:
        | 'INVALID_CWD'
        | 'EXEC_LIMIT'
        | 'DUPLICATE_EXEC'
        | 'BAD_REQUEST'
        | 'OUTPUT_LIMIT'
        | 'REPLAY_UNAVAILABLE'
        | 'OUTPUT_GAP';
      message: string;
    }
) & { seq?: number };

/** Validate every record at both replay and HTTP boundaries. Additive fields
 * are allowed; missing or corrupt payloads must never advance a stream cursor. */
export function isRunnerdExecEvent(value: unknown): value is RunnerdExecEvent {
  if (!isObject(value)) return false;
  if (value.seq !== undefined && !positiveInteger(value.seq)) return false;
  switch (value.t) {
    case 'replay-start':
      return true;
    case 'replay-complete':
      return (
        nonNegativeNumber(value.throughSeq) &&
        Number.isSafeInteger(value.throughSeq)
      );
    case 'start':
      return (
        typeof value.execId === 'string' &&
        value.execId.length > 0 &&
        nonNegativeNumber(value.startedAtMs)
      );
    case 'stdout':
    case 'stderr':
      // Buffer.from(base64) silently ignores corrupt characters. Validate the
      // alphabet and padding without decoding/allocating another output copy.
      return (
        typeof value.b64 === 'string' &&
        value.b64.length % 4 === 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(value.b64)
      );
    case 'exit':
      return (
        typeof value.exitCode === 'number' &&
        Number.isSafeInteger(value.exitCode) &&
        nonNegativeNumber(value.durationMs) &&
        typeof value.timedOut === 'boolean' &&
        typeof value.cancelled === 'boolean' &&
        isObject(value.truncated) &&
        typeof value.truncated.stdout === 'boolean' &&
        typeof value.truncated.stderr === 'boolean'
      );
    case 'fail':
      return (
        typeof value.message === 'string' &&
        (value.code === 'INVALID_CWD' ||
          value.code === 'EXEC_LIMIT' ||
          value.code === 'DUPLICATE_EXEC' ||
          value.code === 'BAD_REQUEST' ||
          value.code === 'OUTPUT_LIMIT' ||
          value.code === 'REPLAY_UNAVAILABLE' ||
          value.code === 'OUTPUT_GAP')
      );
    default:
      return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

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

export const WORKSPACE_ROOT = '/agent';
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Missing cursor starts at zero; malformed cursors must never skip history. */
export function parseRunnerdSequence(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^[0-9]+$/.test(value)) return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : null;
}
