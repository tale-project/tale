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
// Keep both files in sync: runnerd-protocol.test.ts imports both copies and
// fails on any constant that differs or exists on one side only.
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
/** Per-consumer in-flight write ceiling. A slow/stalled (but still attached)
 * SSE consumer would otherwise let Node buffer un-drained stdout in the HTTP
 * response unboundedly. Past this, the daemon stops writing to that ONE
 * consumer (the others are unaffected); it reconnects via /attach?sinceSeq=
 * and replays from the bounded ring. Bounds memory, never truncates output. */
export const RUNNERD_CONSUMER_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
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
  // Case-insensitive: these names carry sandbox plumbing regardless of case,
  // so a lowercase variant (`home`, `tale_runnerd_token`) must not slip a
  // reserved name past the deny-list. The reserved constants are uppercase, so
  // normalize the candidate to compare. (The proxy regex is already `/i`.)
  const upper = name.toUpperCase();
  if ((RUNNERD_ENV_DENYLIST as readonly string[]).includes(upper)) return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name)) return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => upper.startsWith(p));
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
  /** Raw VNC tunnels (GET /screencast) currently piping. A freshly attached
   * viewer also bumps lastActivityAtMs, so watching keeps a session alive. */
  activeScreencasts: number;
  /** Managed live-browser CDP liveness — present only on browser-view sessions
   * (TALE_BROWSER_CDP=1). `cdpHealthy` is a real CDP session round-trip, not
   * just "HTTP answers", so the idle reaper won't pin a dead-CDP-but-watched
   * session and the pane can surface a "recovering" state. */
  browser?: { cdpHealthy: boolean; tabs: number };
}

// --- POST /browser/{restart,reset,close-pages} (browser-view sessions) -------

/** restart (recycle, PRESERVES logins via lock hygiene) /
 * reset (wipe the persistent profile, LOSES logins). */
export interface RunnerdBrowserRecycle {
  /** A managed browser process was found and signalled (SIGKILL → respawn). */
  signalled: boolean;
  /** A CDP session attached again within the bounded wait window. */
  ready: boolean;
  tabs: number;
}

/** close-pages — open tabs closed; cookies/localStorage untouched. */
export interface RunnerdBrowserClosePages {
  closed: number;
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
  /** Absolute (or /agent-relative) cwd; realpath must stay under
   * /agent and exist — INVALID_CWD otherwise, no silent mkdir. */
  cwd?: string;
  /** Per-exec overlay on the session env store (deny-list enforced). */
  env?: Record<string, string>;
  /** Base64 bytes written to the child's stdin, which is then closed.
   * Prompts ride here (never argv — process lists leak argv). */
  stdinBase64?: string;
  /** 'hold' keeps the child's stdin open after writing stdinBase64 so the
   * caller can push further NDJSON lines via POST /execs/:id/stdin (Claude
   * Code --input-format stream-json). Default 'close' = write-then-end. */
  stdinMode?: 'close' | 'hold';
  timeoutMs: number;
  /** Cumulative stdout truncation cap; `<= 0` means UNLIMITED (the live stream
   * is never truncated, memory bounded by runnerd's ring). The spawner sends 0
   * for streaming execs (collectOutput=false), a positive cap otherwise. */
  stdoutMaxBytes: number;
  /** Cumulative stderr truncation cap; `<= 0` means UNLIMITED (see above). */
  stderrMaxBytes: number;
}

// --- POST /execs/:id/stdin ---------------------------------------------------

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

/** NDJSON lines emitted while an exec runs. Exactly one terminal `exit` or
 * `fail` line closes the stream; `stdout`/`stderr` chunks are base64 and
 * preserve byte order within their own stream.
 *
 * `seq` is a monotonic per-exec counter assigned to every emitted event. A
 * consumer that drops its stream reconnects via `GET /attach?sinceSeq=<lastSeq>`
 * and the daemon replays only events with a higher seq — making reconnect
 * idempotent (no missed or double-counted lines). Optional only because the
 * pre-spawn `fail` lines (which can never be reconnected to) skip the counter. */
export type RunnerdExecEvent = (
  | { t: 'start'; execId: string; startedAtMs: number }
  | { t: 'stdout'; b64: string }
  | { t: 'stderr'; b64: string }
  | {
      t: 'exit';
      exitCode: number;
      /**
       * CANONICAL execution wall-clock: measured by runnerd itself, from
       * immediately before `spawn()` (the `start` event's `startedAtMs`) to
       * the child's exit with all stdio drained. Excludes everything outside
       * the process — container/Pod scheduling, image pull, session startup,
       * endpoint resolution, input staging, output harvest — so it is
       * identical on the docker and kubernetes backends, which host the same
       * daemon. Forwarded verbatim into `SessionExecResponse.durationMs`.
       */
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
    }
) & { seq?: number };

// --- POST /execs/:id/cancel --------------------------------------------------

export interface RunnerdCancelResponse {
  /** True when a live process group received the SIGTERM→SIGKILL ladder. */
  killed: boolean;
}

// --- GET /execs/:id ----------------------------------------------------------

/** Per-exec status without consuming the stream. `running` carries startedAtMs;
 * `exited` carries the real exitCode (retained briefly past process exit);
 * `gone` (evicted past the recent window / never existed) surfaces as 404. */
export interface RunnerdExecStatus {
  execId: string;
  state: 'running' | 'exited' | 'gone';
  startedAtMs?: number;
  exitCode?: number | null;
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
