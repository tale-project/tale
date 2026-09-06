// Exec manager — spawns child processes for session execs and streams their
// stdout/stderr as NDJSON events. Byte-faithful and ordered: chunks are
// base64-encoded and emitted in arrival order so the platform-side agent
// adapters can reassemble JSONL without mid-line corruption.
//
// Each exec runs in its own process group (detached) so the timeout/cancel
// path can SIGTERM→SIGKILL the whole tree (a shell that forked rg/node/etc.).

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { Writable } from 'node:stream';

import type { EnvStore } from './env-store.ts';
import {
  ID_ALPHABET_RE,
  RUNNERD_RING_BUFFER_BYTES,
  RUNNERD_STDIN_MAX_BYTES,
  WORKSPACE_ROOT,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
  type RunnerdStdinWriteRequest,
  type RunnerdStdinWriteResponse,
} from './protocol.ts';

const SIGKILL_GRACE_MS = 5_000;
/** After the child's 'exit' fires, how long to wait for stdio 'close' (all
 * output drained) before emitting the terminal event anyway. Bounds the case
 * where a backgrounded grandchild inherited the stdout/stderr pipe and 'close'
 * would otherwise never fire until the whole timeoutMs SIGKILLs the group. */
const EXIT_DRAIN_GRACE_MS = 2_000;
/** How many exited execs keep their ring for replay-after-disconnect. */
const RECENT_EXEC_LIMIT = 16;

type ExecSubscriber = (event: RunnerdExecEvent) => void;

interface LiveExec {
  startedAtMs: number;
  kill: (signal: NodeJS.Signals) => void;
  /** Last RING_BUFFER_BYTES of emitted NDJSON lines, for /attach replay. */
  ring: string[];
  ringBytes: number;
  exitCode: number | null;
  /** Set by cancel() so the terminal exit event reports cancelled:true. */
  cancelRequested: boolean;
  /** Concurrent attach() consumers fanned the live event stream. */
  subscribers: Set<ExecSubscriber>;
  /** Resolves when the exec emits its terminal event. */
  done: Promise<void>;
  /** Monotonic per-exec event counter (assigned in ringEmit). Lets a
   * reconnecting consumer request `/attach?sinceSeq=` and skip replayed lines. */
  seq: number;
  /** SLIDING deadline: the kill timer is re-armed on every attach() — the ONLY
   * refresh — so an actively-attached exec runs UNBOUNDED. A genuinely
   * orphaned exec — no attach for `timeoutMs` — is the only thing this reaps
   * (the orphan backstop; it subsumes the old detach-grace). `timeoutMs` is
   * the window. */
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Set by the deadline timer so the terminal exit event reports timedOut. */
  timedOut: boolean;
  /** Held-open stdin pipe (stdinMode:'hold'), written via writeStdin(). Null
   * for 'close'-mode execs, after EOF, and after the pipe errors (a dead child)
   * — writes then report STDIN_CLOSED instead of falsely confirming delivery. */
  stdin: Writable | null;
}

/** A retained (exited) exec: its final ring for /attach replay plus the exit
 * code, kept so GET /execs/:id can report `exited(code)` after the live record
 * is gone — distinct from an evicted/never-existed exec (404 → 'gone'). */
interface RetainedExec {
  ring: string[];
  exitCode: number | null;
}

export class ExecManager {
  private readonly live = new Map<string, LiveExec>();
  // Exited execs retained briefly so a reconnecting /attach can replay the
  // final ring + terminal event, and so GET /execs/:id can still report the
  // real exit code (insertion-ordered; oldest evicted past cap).
  private readonly recent = new Map<string, RetainedExec>();

  constructor(
    private readonly envStore: EnvStore,
    private readonly onActivity: () => void,
  ) {}

  liveCount(): number {
    return this.live.size;
  }

  /** True if attach() would find the exec (live or recently retained). */
  canAttach(execId: string): boolean {
    return this.live.has(execId) || this.recent.has(execId);
  }

  /**
   * Attach a consumer to an exec: replay its buffered ring, then (if still
   * live) follow new events until it exits. Returns a promise that resolves
   * when the stream is complete, or null if the exec is unknown (neither live
   * nor recently retained). Used by GET /execs/:id/attach for reconnect.
   */
  attach(
    execId: string,
    emit: ExecSubscriber,
    sinceSeq = 0,
  ): Promise<void> | null {
    const liveRec = this.live.get(execId);
    if (liveRec) {
      // A consumer (re)attached → slide the deadline forward by another full
      // window. This is what makes an actively-drained exec run UNBOUNDED: the
      // platform re-attaches every handoff (well within the window), so the
      // kill timer is perpetually pushed out and only ever fires for a
      // genuinely orphaned exec (no attach for the whole window).
      this.armDeadline(liveRec);
      // Replay only what this consumer hasn't seen (seq > sinceSeq), then
      // follow live. The replay loop + subscribers.add are synchronous, so no
      // live event can slip in between (single-threaded) → no gap, no dup.
      for (const line of liveRec.ring) emitRingLine(line, emit, sinceSeq);
      liveRec.subscribers.add(emit);
      return liveRec.done.finally(() => liveRec.subscribers.delete(emit));
    }
    const recentRec = this.recent.get(execId);
    if (recentRec) {
      for (const line of recentRec.ring) emitRingLine(line, emit, sinceSeq);
      return Promise.resolve();
    }
    return null;
  }

  /** (Re)arm the sliding deadline. Called at exec start and on every attach.
   * An actively-attached exec is perpetually extended; an orphaned one (no
   * attach for `timeoutMs`) is SIGTERM→SIGKILLed — the sole orphan reaper. */
  private armDeadline(rec: LiveExec): void {
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      rec.timedOut = true;
      rec.kill('SIGTERM');
      setTimeout(() => rec.kill('SIGKILL'), SIGKILL_GRACE_MS);
    }, rec.timeoutMs);
  }

  private retainRecent(
    execId: string,
    ring: string[],
    exitCode: number | null,
  ): void {
    this.recent.set(execId, { ring, exitCode });
    while (this.recent.size > RECENT_EXEC_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  /** Resolve + validate the cwd. Must realpath to a path under the workspace
   * root and exist (no silent mkdir). Returns null on rejection.
   * TALE_WORKSPACE_ROOT overrides /agent for hermetic unit tests. */
  private resolveCwd(cwd: string | undefined): string | null {
    const root = process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT;
    const requested = cwd ?? root;
    const abs = requested.startsWith('/') ? requested : `${root}/${requested}`;
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return null;
    }
    if (real !== root && !real.startsWith(`${root}/`)) {
      return null;
    }
    return real;
  }

  /**
   * Run one exec, invoking `emit` for each NDJSON event. Resolves when the
   * child has exited (or failed pre-spawn). The caller writes each emitted
   * event to the HTTP response stream AND the ring buffer.
   */
  async run(
    req: RunnerdExecRequest,
    emit: (event: RunnerdExecEvent) => void,
  ): Promise<void> {
    if (!ID_ALPHABET_RE.test(req.execId)) {
      emit({ t: 'fail', code: 'BAD_REQUEST', message: 'invalid execId' });
      return;
    }
    if (this.live.has(req.execId)) {
      emit({ t: 'fail', code: 'DUPLICATE_EXEC', message: req.execId });
      return;
    }
    // Capture into consts so the type narrows without re-reading req.* (which
    // would re-widen) and without assertions.
    const command = Array.isArray(req.command) ? req.command : undefined;
    const shell = typeof req.shell === 'string' ? req.shell : undefined;
    const hasCommand = command !== undefined && command.length > 0;
    const hasShell = shell !== undefined && shell.length > 0;
    if (hasCommand === hasShell) {
      emit({
        t: 'fail',
        code: 'BAD_REQUEST',
        message: 'exactly one of command[] or shell required',
      });
      return;
    }

    const cwd = this.resolveCwd(req.cwd);
    if (cwd === null) {
      emit({
        t: 'fail',
        code: 'INVALID_CWD',
        message: `cwd must resolve under ${WORKSPACE_ROOT} and exist`,
      });
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.envStore.resolve(req.env),
    };

    const cmd = hasShell ? 'bash' : (command?.[0] ?? '');
    const args = hasShell ? ['-lc', shell ?? ''] : (command?.slice(1) ?? []);

    this.onActivity();
    const startedAtMs = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env,
      // Own process group so we can signal the whole tree on timeout/cancel.
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTrunc = false;
    let stderrTrunc = false;
    // Per-exec one-time truncation log. Closure-scoped (NOT module-level) so a
    // long-lived daemon running many capped execs warns once PER exec, never
    // going silent again after the first.
    let stdoutTruncLogged = false;
    let stderrTruncLogged = false;
    let settled = false;
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    const record: LiveExec = {
      startedAtMs,
      exitCode: null,
      ring: [],
      ringBytes: 0,
      cancelRequested: false,
      subscribers: new Set(),
      done,
      seq: 0,
      timeoutMs: req.timeoutMs,
      timer: null,
      timedOut: false,
      stdin: null,
      kill: (signal) => {
        try {
          // Negative pid → signal the whole process group.
          if (child.pid !== undefined) process.kill(-child.pid, signal);
        } catch (err) {
          // Already gone (ESRCH) — nothing to kill. Log for visibility; other
          // errno (e.g. EPERM) is a real config problem worth surfacing.
          console.warn(
            `[runnerd] kill(${signal}) of pgroup ${child.pid} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      },
    };
    this.live.set(req.execId, record);

    const ringEmit = (event: RunnerdExecEvent) => {
      // Stamp a monotonic seq so a reconnecting /attach?sinceSeq= can replay
      // only events it hasn't seen — idempotent reconnect.
      record.seq += 1;
      const stamped: RunnerdExecEvent = { ...event, seq: record.seq };
      emit(stamped);
      // Fan out to any concurrent /attach consumers.
      for (const sub of record.subscribers) {
        try {
          sub(stamped);
        } catch (err) {
          console.warn('[runnerd] attach subscriber threw:', err);
        }
      }
      const line = `${JSON.stringify(stamped)}\n`;
      record.ring.push(line);
      record.ringBytes += Buffer.byteLength(line, 'utf8');
      while (
        record.ringBytes > RUNNERD_RING_BUFFER_BYTES &&
        record.ring.length > 1
      ) {
        const dropped = record.ring.shift();
        if (dropped === undefined) break;
        record.ringBytes -= Buffer.byteLength(dropped, 'utf8');
      }
    };

    ringEmit({ t: 'start', execId: req.execId, startedAtMs });

    if (req.stdinMode === 'hold') {
      // Held-open stdin: the initial payload is written but NOT ended; later
      // POST /execs/:id/stdin calls append lines until eof. A child that exits
      // first makes pending writes EPIPE — swallow via the error handler so an
      // unhandled stream error can't crash the daemon.
      child.stdin.on('error', (err) => {
        console.warn('[runnerd] held stdin pipe error:', err.message);
        // The pipe is now dead (EPIPE arrives here async — write() never throws
        // synchronously for it). Null it so a subsequent writeStdin refuses with
        // STDIN_CLOSED and the platform falls back to file staging, instead of
        // reporting ok:true for a write the exited child never received.
        record.stdin = null;
      });
      record.stdin = child.stdin;
      if (req.stdinBase64) {
        try {
          child.stdin.write(Buffer.from(req.stdinBase64, 'base64'));
        } catch (err) {
          console.warn('[runnerd] initial stdin write failed:', err);
        }
      }
    } else {
      // Close-mode stdin: write the initial payload (if any) and EOF at once.
      // Register an error listener FIRST — a child that exits before draining
      // its stdin makes the end() pipe EPIPE ASYNCHRONOUSLY (write/end never
      // throw synchronously for it), and without a listener Node escalates that
      // to an unhandled 'error' that crashes the whole long-lived daemon, taking
      // down every concurrent session. Mirror the held-stdin guard above.
      child.stdin.on('error', (err) => {
        console.warn('[runnerd] close-mode stdin pipe error:', err.message);
      });
      if (req.stdinBase64) {
        try {
          child.stdin.end(Buffer.from(req.stdinBase64, 'base64'));
        } catch (err) {
          // stdin may already be closed if the child exited instantly.
          console.warn('[runnerd] initial stdin end failed:', err);
        }
      } else {
        child.stdin.end();
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      // Drop data that arrives after the terminal event (only reachable when a
      // grace-forced finish raced a leaked-fd writer — see the 'exit'/'close'
      // handling below). Keeps the start..stdout..exit order the platform
      // adapters depend on and never mutates the already-retained ring.
      if (settled) return;
      // stdoutMaxBytes <= 0 ⇒ UNLIMITED: never truncate (the ring + per-consumer
      // buffer ceiling bound memory). Long-lived streaming execs pass 0 so their
      // live output is never silently cut off mid-run.
      if (req.stdoutMaxBytes > 0) {
        const remaining = req.stdoutMaxBytes - stdoutBytes;
        if (remaining <= 0) {
          if (!stdoutTruncLogged) {
            stdoutTruncLogged = true;
            console.warn(
              `[runnerd] exec ${req.execId} stdout hit cap ${req.stdoutMaxBytes}B — further stdout dropped (truncated)`,
            );
          }
          stdoutTrunc = true;
          return;
        }
        if (chunk.byteLength > remaining) {
          // Crossing chunk: emit only the bytes that fit under the cap, then
          // mark truncated so the rest is dropped at the next 'data'.
          stdoutBytes += remaining;
          stdoutTrunc = true;
          ringEmit({
            t: 'stdout',
            b64: chunk.subarray(0, remaining).toString('base64'),
          });
          return;
        }
      }
      stdoutBytes += chunk.byteLength;
      ringEmit({ t: 'stdout', b64: chunk.toString('base64') });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (req.stderrMaxBytes > 0) {
        const remaining = req.stderrMaxBytes - stderrBytes;
        if (remaining <= 0) {
          if (!stderrTruncLogged) {
            stderrTruncLogged = true;
            console.warn(
              `[runnerd] exec ${req.execId} stderr hit cap ${req.stderrMaxBytes}B — further stderr dropped (truncated)`,
            );
          }
          stderrTrunc = true;
          return;
        }
        if (chunk.byteLength > remaining) {
          stderrBytes += remaining;
          stderrTrunc = true;
          ringEmit({
            t: 'stderr',
            b64: chunk.subarray(0, remaining).toString('base64'),
          });
          return;
        }
      }
      stderrBytes += chunk.byteLength;
      ringEmit({ t: 'stderr', b64: chunk.toString('base64') });
    });
    // The output pipes can emit 'error' (e.g. a rare pipe EIO). Without a
    // listener Node throws it as an unhandled stream error and crashes the whole
    // long-lived daemon — taking down every concurrent session, not just this
    // exec. (child.on('error') above is the ChildProcess emitter, distinct from
    // these stdio stream emitters.) Log and swallow to keep the daemon alive.
    child.stdout.on('error', (err) => {
      console.warn('[runnerd] stdout pipe error:', err.message);
    });
    child.stderr.on('error', (err) => {
      console.warn('[runnerd] stderr pipe error:', err.message);
    });

    // Arm the SLIDING deadline (the sole orphan reaper). attach() re-arms it on
    // every reconnect, so an actively-drained exec is never killed by it.
    this.armDeadline(record);

    await new Promise<void>((resolve) => {
      // Finalize on 'close' (every stdio stream drained → the terminal 'exit'
      // event can't race a trailing stdout/stderr chunk), with a bounded
      // fallback armed on 'exit': a backgrounded grandchild that inherited the
      // pipe would otherwise hold 'close' off until the whole timeoutMs kills
      // the group.
      let exited = false;
      let closed = false;
      let exitCode = -1;
      let drainTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (record.timer) clearTimeout(record.timer);
        if (drainTimer) clearTimeout(drainTimer);
        record.exitCode = code;
        this.onActivity();
        ringEmit({
          t: 'exit',
          exitCode: code,
          // The canonical execution wall-clock (protocol.ts `exit.durationMs`):
          // startedAtMs was taken immediately before spawn(), and finish() runs
          // only once stdio is drained — nothing outside the process
          // (scheduling, staging, harvest) can leak into the measurement.
          durationMs: Date.now() - startedAtMs,
          truncated: { stdout: stdoutTrunc, stderr: stderrTrunc },
          timedOut: record.timedOut,
          cancelled: record.cancelRequested,
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring, code);
        resolveDone();
        resolve();
      };
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (record.timer) clearTimeout(record.timer);
        if (drainTimer) clearTimeout(drainTimer);
        ringEmit({
          t: 'fail',
          code: 'BAD_REQUEST',
          message: `spawn failed: ${err.message}`,
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring, null);
        resolveDone();
        resolve();
      });
      child.on('exit', (code, signal) => {
        // 128 + signal number is the conventional shell exit for a signal.
        exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 15) : -1);
        exited = true;
        // stdio already closed (normal fast path) → emit now; otherwise wait a
        // bounded grace for 'close' before forcing the terminal event.
        if (closed) finish(exitCode);
        else
          drainTimer = setTimeout(() => finish(exitCode), EXIT_DRAIN_GRACE_MS);
      });
      child.on('close', () => {
        // All stdio streams closed: every 'data' event has been delivered, so
        // the terminal 'exit' event is now guaranteed last and complete.
        closed = true;
        if (exited) finish(exitCode);
      });
    });
  }

  /** SIGTERM→SIGKILL the exec's process group. Returns true if it was live.
   * The ONLY platform-initiated kill (a user Stop) — distinct from the sliding
   * orphan deadline. */
  cancel(execId: string): boolean {
    const rec = this.live.get(execId);
    if (!rec) return false;
    if (rec.timer) clearTimeout(rec.timer);
    rec.cancelRequested = true;
    rec.kill('SIGTERM');
    setTimeout(() => rec.kill('SIGKILL'), SIGKILL_GRACE_MS);
    return true;
  }

  /** Per-exec status WITHOUT consuming the stream: `running` (live), `exited`
   * (recently retained — carries the real exitCode), or null (`gone`: evicted
   * past the recent window or never existed). The platform's restorative
   * recovery path keys off this to decide resume vs finalize. */
  status(
    execId: string,
  ):
    | { state: 'running'; startedAtMs: number }
    | { state: 'exited'; exitCode: number | null }
    | null {
    const rec = this.live.get(execId);
    if (rec) return { state: 'running', startedAtMs: rec.startedAtMs };
    const retained = this.recent.get(execId);
    if (retained) return { state: 'exited', exitCode: retained.exitCode };
    return null;
  }

  /** Append a line to a held-open stdin (stdinMode:'hold') and/or close it.
   * Always answers with a structured response — the platform turns
   * STDIN_CLOSED/NOT_FOUND into its file-staging fallback. */
  writeStdin(
    execId: string,
    req: RunnerdStdinWriteRequest,
  ): RunnerdStdinWriteResponse {
    const rec = this.live.get(execId);
    if (!rec) return { ok: false, reason: 'NOT_FOUND' };
    if (!rec.stdin) return { ok: false, reason: 'STDIN_CLOSED' };
    // A write to a broken pipe (the child exited but its record is still live —
    // e.g. inside the EXIT_DRAIN_GRACE_MS window, or between cancel()'s SIGTERM
    // and SIGKILL) returns false and emits 'error' asynchronously; it never
    // throws synchronously, so the try/catch below cannot observe it. Returning
    // ok:true there makes the platform mark a steer message delivered and skip
    // its file-staging fallback, silently dropping it. Refuse on a stream that
    // is no longer writable so the caller falls back instead.
    if (!isStdinWritable(rec.stdin)) {
      return { ok: false, reason: 'STDIN_CLOSED' };
    }
    let buf: Buffer | null = null;
    if (req.b64 !== undefined && req.b64 !== '') {
      buf = Buffer.from(req.b64, 'base64');
      if (!isSingleNdjsonLine(buf)) return { ok: false, reason: 'BAD_LINE' };
    }
    try {
      if (buf) rec.stdin.write(buf);
      if (req.eof) {
        rec.stdin.end();
        rec.stdin = null;
      }
    } catch (err) {
      console.warn('[runnerd] stdin write failed:', err);
      return { ok: false, reason: 'WRITE_FAILED' };
    }
    this.onActivity();
    return { ok: true };
  }
}

/** A held-stdin pipe is still usable only while it can accept writes. Once it
 * has ended, been destroyed, or errored (a dead child's pipe EPIPEs
 * ASYNCHRONOUSLY — write() never throws synchronously, so a state check is the
 * only way to refuse before falsely reporting ok:true), a write would be
 * silently dropped. Exported for unit testing — the EPIPE path itself only
 * surfaces under Node (the production runtime), not the Bun test harness. */
export function isStdinWritable(stdin: Writable): boolean {
  return !stdin.writableEnded && !stdin.destroyed && !stdin.errored;
}

/** Exactly one newline-terminated, interior-newline-free, valid-JSON line.
 * Claude Code's stream-json reader exits the whole process on a malformed
 * line (verified 2.1.173) — fail closed rather than kill the agent. */
function isSingleNdjsonLine(buf: Buffer): boolean {
  if (buf.byteLength === 0 || buf.byteLength > RUNNERD_STDIN_MAX_BYTES) {
    return false;
  }
  const text = buf.toString('utf8');
  if (!text.endsWith('\n')) return false;
  const line = text.slice(0, -1);
  if (line.includes('\n')) return false;
  try {
    JSON.parse(line);
  } catch {
    return false;
  }
  return true;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Narrow a parsed ring line to a RunnerdExecEvent. Lines are produced by
 * ringEmit (JSON.stringify of our own union), so this is defence-in-depth, but
 * it keeps the replay path cast-free: validate the `t` discriminator + the
 * required per-variant fields before emitting. */
function isRunnerdExecEvent(v: unknown): v is RunnerdExecEvent {
  if (!isObject(v)) return false;
  if (v.seq !== undefined && typeof v.seq !== 'number') return false;
  switch (v.t) {
    case 'start':
      return typeof v.execId === 'string' && typeof v.startedAtMs === 'number';
    case 'stdout':
    case 'stderr':
      return typeof v.b64 === 'string';
    case 'exit':
      return (
        typeof v.exitCode === 'number' &&
        typeof v.durationMs === 'number' &&
        typeof v.timedOut === 'boolean' &&
        typeof v.cancelled === 'boolean' &&
        isObject(v.truncated)
      );
    case 'fail':
      return typeof v.code === 'string' && typeof v.message === 'string';
    default:
      return false;
  }
}

/** Parse a retained ring line (NDJSON) back to an event for attach replay,
 * skipping anything the reconnecting consumer already saw (seq <= sinceSeq). */
function emitRingLine(line: string, emit: ExecSubscriber, sinceSeq = 0): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRunnerdExecEvent(parsed)) {
      console.warn('[runnerd] ring line is not a RunnerdExecEvent:', trimmed);
      return;
    }
    if ((parsed.seq ?? 0) <= sinceSeq) return;
    emit(parsed);
  } catch (err) {
    console.warn('[runnerd] bad ring line during attach replay:', err);
  }
}

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
};
