// Exec manager — spawns child processes for session execs and streams their
// stdout/stderr as NDJSON events. Byte-faithful and ordered: chunks are
// base64-encoded and emitted in arrival order so the platform-side agent
// adapters can reassemble JSONL without mid-line corruption.
//
// Each exec runs in its own process group (detached) and carries its id in
// the environment, so ending it — at exit, on cancel, at its deadline —
// reaches the whole tree (a shell that forked rg/node/etc., a backgrounded
// server, a browser its driver spawned detached; process-reaper.ts). In the
// runtime image it also runs under a subreaper shim (tale-exec-shim), which
// keeps everything the exec starts its descendant, even a process that left
// the group and rewrote its environment. What an exec leaves running ends
// with it, or — while another exec of the session still runs and may be
// using it — once the session's last exec ends. A cancel that hands the exec
// over (a steer's restart) ends only its own group and holds the rest for
// the exec that takes over.

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, realpathSync } from 'node:fs';
import { Readable, type Writable } from 'node:stream';

import type { EnvStore } from './env-store.ts';
import {
  EXEC_TAG_ENV,
  groupMembers,
  processesLeft,
  signalExecProcesses,
  signalGroup,
  type GroupMember,
  type ReaperDeps,
  type ReapTarget,
} from './process-reaper.ts';
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
/** Past this many waiting leftovers, the ones whose processes are all gone
 * are dropped — a session that always has a live exec never empties them. */
const LEFTOVER_PRUNE_AT = 256;
/** How long what a rotation's cancel handed over waits for its successor:
 * a restart that never got its new exec (its start failed) must not keep a
 * dev server running in the session until the next exec of some later turn
 * ends. */
const HOLD_MAX_MS = 10 * 60_000;

type ExecSubscriber = (event: RunnerdExecEvent) => void;

/** A reaping target, with whether its leader is still running: while it is,
 * its pid — the group's number — cannot have been reused, so the delayed
 * SIGKILL may go to the group even where no tagged process shows in it (a
 * scrubbed environment, an unreadable one). */
interface Reaping extends ReapTarget {
  leaderRunning?: () => boolean;
}

/** What an exited or handed-over exec left, waiting to be ended. */
interface Leftover extends ReapTarget {
  /** Held for the exec that takes over from a cancelled one: how many execs
   * had started when the hold began. An exec started after that ending
   * lifts the hold; until then the session's last exec ending does not end
   * these. */
  heldSince?: number;
}

/** Where the per-exec subreaper shim is installed in the runtime image. */
const EXEC_SHIM_PATH = '/usr/local/bin/tale-exec-shim';

/**
 * The subreaper shim every exec runs under, or null where there is none (a
 * development host that is not Linux, an image without it): execs then run
 * directly, and their leftovers are found by group and tag alone.
 * TALE_EXEC_SHIM names another path; empty, it turns the shim off.
 */
export function resolveExecShim(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'linux') return null;
  const path = env.TALE_EXEC_SHIM ?? EXEC_SHIM_PATH;
  if (path === '') return null;
  try {
    accessSync(path, fsConstants.X_OK);
    return path;
  } catch {
    return null;
  }
}

interface LiveExec {
  startedAtMs: number;
  /** This exec's place in the order the session's execs started. */
  ordinal: number;
  /** The exec's process group: the child's pid (spawned detached). */
  groupId: number | undefined;
  /** End every process of the exec now — SIGTERM, then SIGKILL once
   * {@link SIGKILL_GRACE_MS} has passed — on a cancel, at the deadline or
   * when the daemon goes down. Once per exec. */
  terminate: () => void;
  terminated: boolean;
  /** The child itself exited (its 'exit' fired). */
  leaderExited: boolean;
  /** The exec's subreaper shim, when it runs under one: every process it
   * started is the shim's descendant. */
  rootPid: number | undefined;
  /** The shim exited: no descendant of it is left, and its pid may name
   * another process now. */
  rootExited: boolean;
  /** The shim has yet to name the command's group on its status pipe. */
  groupPending: boolean;
  /** What waits for the shim to name the command's group: a cancel that
   * came before it did. */
  awaitingGroup: Array<() => void>;
  /** A rotation's cancel handed what the exec left to the exec that takes
   * over: a later cancel or deadline of this one ends none of it. */
  handedOver: boolean;
  /** What the exit (or a hand-over) left waiting, while it still waits; a
   * cancel or the deadline ends it at once. */
  deferred: Leftover | null;
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
  // Execs that exited while another exec of the session ran: what they left
  // running ends with the session's last live exec. Execs handed over to a
  // successor: what they left outside their group ends once the successor
  // has, and with the session's last live exec.
  private readonly leftovers: Leftover[] = [];
  private pruningLeftovers = false;
  /** How many execs this session has started. */
  private started = 0;

  constructor(
    private readonly envStore: EnvStore,
    private readonly onActivity: () => void,
    /** Runs just before each child spawns (runnerd: the built-in skill
     * links, `baked-skills.ts`); must not throw. */
    private readonly beforeSpawn: () => void = () => {},
    private readonly reaper: ReaperDeps = {},
    private readonly options: {
      holdMaxMs?: number;
      /** The subreaper shim to run execs under; unset, {@link
       * resolveExecShim}'s, and null for none. */
      execShim?: string | null;
    } = {},
  ) {
    this.execShim =
      options.execShim === undefined ? resolveExecShim() : options.execShim;
  }

  /** The subreaper shim execs run under, or null: they run directly. */
  readonly execShim: string | null;

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
    /** The consumer went away: stop following, and settle at once instead of
     * when the exec ends — a platform that re-attaches every window would
     * otherwise leave one subscriber (and one open operation) per window. */
    signal?: AbortSignal,
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
      if (signal?.aborted) return Promise.resolve();
      liveRec.subscribers.add(emit);
      const gone = new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return Promise.race([liveRec.done, gone]).finally(() =>
        liveRec.subscribers.delete(emit),
      );
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
      this.endNow(rec);
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
      [EXEC_TAG_ENV]: req.execId,
    };

    const cmd = hasShell ? 'bash' : (command?.[0] ?? '');
    const args = hasShell ? ['-lc', shell ?? ''] : (command?.slice(1) ?? []);

    this.onActivity();
    this.beforeSpawn();
    const startedAtMs = Date.now();
    // Under the subreaper shim, the command runs as its child in a process
    // group of its own and everything it starts stays the shim's descendant;
    // the shim says on its status pipe (fd 3) when the command started,
    // exited or could not be executed. Without it, the command is the child,
    // in its own process group, so the whole tree can still be signalled.
    const shim = this.execShim;
    const child =
      shim !== null
        ? spawn(shim, ['--', cmd, ...args], {
            cwd,
            env,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          })
        : spawn(cmd, args, {
            cwd,
            env,
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

    this.started += 1;
    const record: LiveExec = {
      startedAtMs,
      ordinal: this.started,
      // Under the shim the group is the command's, named on the status pipe.
      groupId: shim !== null ? undefined : child.pid,
      rootPid: shim !== null ? child.pid : undefined,
      rootExited: false,
      groupPending: shim !== null,
      awaitingGroup: [],
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
      terminated: false,
      leaderExited: false,
      handedOver: false,
      deferred: null,
      terminate: () => {
        if (record.terminated) return;
        record.terminated = true;
        this.withGroup(record, () => {
          void this.reap([this.liveTarget(req.execId, record)]);
        });
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
      // Finalize once the command exited and its output pipes closed (every
      // stdout/stderr chunk delivered → the terminal 'exit' event can't race
      // a trailing one), with a bounded fallback armed on the exit: a
      // backgrounded grandchild that inherited the pipe would otherwise hold
      // the close off until the whole timeoutMs kills the group. The pipes'
      // own close is watched, not the child's: under the shim the child
      // process outlives the command for as long as anything it started does.
      let exited = false;
      let closed = false;
      let stdoutClosed = false;
      let stderrClosed = false;
      let exitCode = -1;
      let drainTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (record.timer) clearTimeout(record.timer);
        if (drainTimer) clearTimeout(drainTimer);
        if (!closed && record.deferred === null) {
          // Forced past the drain grace: a process that outlived the exec
          // still holds the pipes. Close our ends, or every such exec keeps
          // two descriptors of this daemon open for as long as it lives. Not
          // while its leftovers wait for the session's last exec: closing
          // them would kill a dev server at its next line of output. Their
          // output is read and dropped until they end.
          child.stdout.destroy();
          child.stderr.destroy();
        }
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
        this.dropLive(req.execId);
        this.retainRecent(req.execId, record.ring, code);
        resolveDone();
        resolve();
      };
      // The command could not be executed: nothing of it is left to end.
      let couldNotRun = false;
      const spawnFailed = (message: string) => {
        if (settled) return;
        settled = true;
        couldNotRun = true;
        if (record.timer) clearTimeout(record.timer);
        if (drainTimer) clearTimeout(drainTimer);
        ringEmit({
          t: 'fail',
          code: 'BAD_REQUEST',
          message: `spawn failed: ${message}`,
        });
        this.dropLive(req.execId);
        this.retainRecent(req.execId, record.ring, null);
        resolveDone();
        resolve();
      };
      child.on('error', (err) => {
        spawnFailed(err.message);
      });
      let commandExited = false;
      const commandExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => {
        if (commandExited || couldNotRun) return;
        commandExited = true;
        // 128 + signal number is the conventional shell exit for a signal.
        exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 15) : -1);
        exited = true;
        record.leaderExited = true;
        // The exec is over: whatever it left running (a `cmd &`, a `nohup`
        // worker, a browser) ends with it instead of holding memory and pids
        // in a session that reads idle — at once when no other exec of the
        // session runs, which also closes the pipes a leftover inherited so
        // the exit is reported without the grace. While another exec runs,
        // it may be using what this one started (a build daemon, a dev
        // server): the leftovers wait for the session's last exec to end,
        // with a record of the group's processes as the leader leaves them —
        // the proof, later, that the group is still the exec's even where no
        // process in it carries the tag.
        if (!record.terminated) {
          record.terminated = true;
          const self: Reaping = {
            execId: req.execId,
            groupId: record.groupId,
            ...this.rootOf(record),
          };
          const othersLive = [...this.live.keys()].some(
            (id) => id !== req.execId,
          );
          this.liftHolds(record.ordinal);
          if (othersLive) {
            // Under the shim its descendants are the proof; without it, a
            // record of the group's processes as the leader leaves them.
            const waiting: Leftover = {
              ...self,
              ...(record.rootPid === undefined
                ? { members: this.recordGroup(req.execId, record.groupId) }
                : {}),
            };
            record.deferred = waiting;
            this.deferLeftovers(waiting);
          } else {
            void this.reap([
              ...this.takeUnheldLeftovers(),
              { ...self, groupKnown: true },
            ]);
          }
        }
        // stdio already closed (normal fast path) → emit now; otherwise wait a
        // bounded grace for 'close' before forcing the terminal event.
        if (closed) finish(exitCode);
        else
          drainTimer = setTimeout(() => finish(exitCode), EXIT_DRAIN_GRACE_MS);
      };
      if (shim !== null) {
        // The shim's status pipe: the command's pid (its group), its exit,
        // or why it could not be executed. The pipe, not the shim's own
        // exit, says how the command ended: the shim outlives it for as
        // long as anything it started runs, and its exit can be seen
        // before the last line is read. Only a pipe that ended without the
        // command's end (the shim was killed) leaves it to the shim's exit.
        const status = child.stdio[3];
        let statusEnded = !(status instanceof Readable);
        let shimExit: {
          code: number | null;
          signal: NodeJS.Signals | null;
        } | null = null;
        const shimOver = () => {
          if (!statusEnded || shimExit === null) return;
          this.groupSettled(record);
          commandExit(shimExit.code, shimExit.signal);
        };
        if (status instanceof Readable) {
          let pending = '';
          status.on('data', (chunk: Buffer) => {
            pending += chunk.toString('latin1');
            for (
              let end = pending.indexOf('\n');
              end !== -1;
              end = pending.indexOf('\n')
            ) {
              const [kind, value = ''] = pending.slice(0, end).split(' ');
              pending = pending.slice(end + 1);
              if (kind === 'pid') {
                const pid = Number(value);
                if (Number.isInteger(pid) && pid > 1) record.groupId = pid;
                this.groupSettled(record);
              } else if (kind === 'no-subreaper') {
                // What the command starts is reparented to init, not to
                // the shim: its leftovers are found by group and tag.
                record.rootPid = undefined;
                warnNoSubreaper(value);
              } else if (kind === 'exit' || kind === 'signal') {
                // A line that is no number is left to the shim's own exit.
                const number = Number(value);
                if (!Number.isInteger(number) || number < 0) continue;
                // 128 + signal number, as for a command run directly.
                commandExit(kind === 'exit' ? number : 128 + number, null);
              } else if (kind === 'spawn-error') {
                spawnFailed(`spawn ${cmd} ${value}`);
              }
            }
          });
          status.on('error', (err) => {
            console.warn('[runnerd] exec shim status pipe error:', err.message);
          });
          status.on('close', () => {
            statusEnded = true;
            this.groupSettled(record);
            shimOver();
          });
        } else {
          // Without its status pipe, no group will be named.
          this.groupSettled(record);
        }
        child.on('exit', (code, signal) => {
          // The shim waits until nothing it adopted is left.
          record.rootExited = true;
          shimExit = { code, signal };
          shimOver();
        });
      } else {
        child.on('exit', (code, signal) => {
          commandExit(code, signal);
        });
      }
      const outputClosed = () => {
        if (!stdoutClosed || !stderrClosed) return;
        // Both output pipes closed: every 'data' event has been delivered,
        // so the terminal 'exit' event is now guaranteed last and complete.
        closed = true;
        if (exited) finish(exitCode);
      };
      child.stdout.on('close', () => {
        stdoutClosed = true;
        outputClosed();
      });
      child.stderr.on('close', () => {
        stderrClosed = true;
        outputClosed();
      });
    });
  }

  /** End a live exec at the platform's request — distinct from the sliding
   * orphan deadline. A user's Stop ends every process of the exec. A
   * rotation (`keepLeftovers`: a steer's restart, which continues the
   * conversation in a new exec over the same workspace) ends only the exec's
   * own group, and holds what it left outside the group (a dev server the
   * turn started from a tool call) for the exec that takes over. Returns
   * true if it was live. */
  cancel(execId: string, opts: { keepLeftovers?: boolean } = {}): boolean {
    const rec = this.live.get(execId);
    if (!rec) return false;
    if (rec.timer) clearTimeout(rec.timer);
    rec.cancelRequested = true;
    if (opts.keepLeftovers === true) this.handOver(execId, rec);
    else this.endNow(rec);
    return true;
  }

  /** A rotation's cancel: SIGTERM to the exec's own group, SIGKILL to it
   * while its leader still runs once the grace has passed, and what the exec
   * left outside the group held until an exec started after this one ends.
   * Ending those too would leave the restarted turn, which goes on where
   * this one stopped, with the servers it started gone. */
  private handOver(execId: string, rec: LiveExec): void {
    const waiting = rec.deferred;
    if (waiting !== null) {
      // Its leader already exited: what it left waits on, for the
      // successor as well.
      rec.handedOver = true;
      this.holdForSuccessor(waiting);
      return;
    }
    if (rec.terminated) return;
    rec.terminated = true;
    rec.handedOver = true;
    const held: Leftover = {
      execId,
      groupId: rec.groupId,
      ...this.rootOf(rec),
    };
    this.holdForSuccessor(held);
    // Kept as the exec's deferred leftovers, so its pipes stay open for
    // them while it drains.
    rec.deferred = held;
    this.deferLeftovers(held);
    this.withGroup(rec, () => {
      const group = rec.groupId;
      held.groupId = group;
      signalGroup(group, 'SIGTERM', this.reaper);
      setTimeout(() => {
        if (!rec.leaderExited) signalGroup(group, 'SIGKILL', this.reaper);
      }, SIGKILL_GRACE_MS).unref();
    });
  }

  /** Run `then` once the exec's group is known: at once, unless the exec
   * runs under a shim that has not named it yet — then as soon as the shim
   * does, or is gone. A cancel that comes in that moment so still reaches
   * the group as a whole, in one signal. */
  private withGroup(rec: LiveExec, then: () => void): void {
    if (rec.groupPending) rec.awaitingGroup.push(then);
    else then();
  }

  /** The shim named the command's group, or never will: run what waited
   * for it. */
  private groupSettled(rec: LiveExec): void {
    rec.groupPending = false;
    for (const then of rec.awaitingGroup.splice(0)) then();
  }

  /** Hold what a handed-over exec left for an exec started after now — at
   * most {@link HOLD_MAX_MS}: past that, the hold lifts, and with no exec
   * running what it held ends at once. */
  private holdForSuccessor(leftover: Leftover): void {
    leftover.heldSince = this.started;
    const since = leftover.heldSince;
    setTimeout(() => {
      if (leftover.heldSince !== since) return;
      leftover.heldSince = undefined;
      if (this.live.size === 0) void this.reap(this.takeUnheldLeftovers());
    }, this.options.holdMaxMs ?? HOLD_MAX_MS).unref();
  }

  /** End an exec's processes now, on a cancel or at its deadline — what it
   * left waiting for the session's last exec too, when its own process has
   * already exited and its drain is under way. */
  private endNow(rec: LiveExec): void {
    const waiting = rec.deferred;
    if (waiting === null) {
      rec.terminate();
      return;
    }
    // What it left is the successor's now. The platform's superseded drive
    // still reaps the exec it no longer owns, and may do so while it drains;
    // a person's Stop goes to the successor, whose end ends these too.
    if (rec.handedOver) return;
    rec.deferred = null;
    // Not in the list any more: a round already took it.
    const at = this.leftovers.indexOf(waiting);
    if (at === -1) return;
    this.leftovers.splice(at, 1);
    void this.reap([waiting]);
  }

  /** A live exec as a reaping target: its group is certainly its own. */
  private liveTarget(execId: string, rec: LiveExec): Reaping {
    return {
      execId,
      groupId: rec.groupId,
      groupKnown: true,
      leaderRunning: () => !rec.leaderExited,
      ...this.rootOf(rec),
    };
  }

  /** The exec's subreaper shim as a reaping root, while it runs. */
  private rootOf(rec: LiveExec): Pick<ReapTarget, 'rootPid' | 'rootAlive'> {
    if (rec.rootPid === undefined) return {};
    return { rootPid: rec.rootPid, rootAlive: () => !rec.rootExited };
  }

  /** The daemon is going down: every live exec, and what exited execs left
   * waiting, gets its SIGTERM. Resolves once the signals are sent. */
  async terminateAll(): Promise<void> {
    const targets: Reaping[] = this.leftovers.splice(0);
    for (const [execId, rec] of this.live) {
      if (rec.terminated) continue;
      rec.terminated = true;
      targets.push(this.liveTarget(execId, rec));
    }
    await this.reap(targets);
  }

  /** How many exited or handed-over execs' leftovers wait. */
  leftoverCount(): number {
    return this.leftovers.length;
  }

  /** Remove an exec from the live set; when it was the session's last, what
   * earlier execs left waiting ends now — except what is still held for an
   * exec that has not yet run. */
  private dropLive(execId: string): void {
    const rec = this.live.get(execId);
    this.live.delete(execId);
    if (rec !== undefined) this.liftHolds(rec.ordinal);
    if (this.live.size === 0) void this.reap(this.takeUnheldLeftovers());
  }

  /** The exec in place `ordinal` is ending: a hold that began before it
   * started has had its successor. */
  private liftHolds(ordinal: number): void {
    for (const leftover of this.leftovers) {
      if (leftover.heldSince !== undefined && ordinal > leftover.heldSince) {
        leftover.heldSince = undefined;
      }
    }
  }

  /** Take the waiting leftovers no hold keeps. */
  private takeUnheldLeftovers(): Leftover[] {
    const due = this.leftovers.filter((t) => t.heldSince === undefined);
    if (due.length === 0) return [];
    const held = this.leftovers.filter((t) => t.heldSince !== undefined);
    this.leftovers.splice(0, this.leftovers.length, ...held);
    return due;
  }

  /** Keep an exited exec's leftovers for the session's last exec to end. */
  private deferLeftovers(target: Leftover): void {
    this.leftovers.push(target);
    if (this.leftovers.length < LEFTOVER_PRUNE_AT || this.pruningLeftovers) {
      return;
    }
    this.pruningLeftovers = true;
    void this.pruneLeftovers()
      .catch((error: unknown) => {
        console.warn('[runnerd] leftover prune failed:', error);
      })
      .finally(() => {
        this.pruningLeftovers = false;
      });
  }

  /** Drop the waiting leftovers whose processes are all gone. */
  private async pruneLeftovers(): Promise<void> {
    const scanned = this.leftovers.slice();
    const left = await processesLeft(scanned, this.reaper);
    if (left === null) return;
    // A target deferred during the scan may have processes it missed.
    const gone = new Set(scanned.filter((_, index) => left[index] !== true));
    const kept = this.leftovers.filter((t) => !gone.has(t));
    this.leftovers.splice(0, this.leftovers.length, ...kept);
  }

  /** The processes of an exec's group as a scan finds them now, for a later
   * round to prove the group is still the exec's. */
  private recordGroup(
    execId: string,
    groupId: number | undefined,
  ): Promise<GroupMember[]> {
    return groupMembers(groupId, this.reaper).catch((error: unknown) => {
      console.warn(`[runnerd] recording exec ${execId}'s group failed:`, error);
      return [];
    });
  }

  /** One reaping round: SIGTERM now, SIGKILL to whatever is left once the
   * grace has passed — by then a group counts as the exec's while its leader
   * still runs, else only while a process tagged with the exec, or one the
   * SIGTERM round saw in the group (or the target's own record), is still
   * in it. A group known to be the exec's gets each signal at once, before
   * the process table is read. Resolves once the SIGTERM is sent. */
  private async reap(targets: Reaping[]): Promise<void> {
    if (targets.length === 0) return;
    const round = (signal: NodeJS.Signals, of: ReapTarget[]) =>
      signalExecProcesses(of, signal, this.reaper).catch((error: unknown) => {
        console.warn(`[runnerd] ${signal} round failed:`, error);
        return null;
      });
    const term = round(
      'SIGTERM',
      targets.map(
        ({ execId, groupId, groupKnown, members, rootPid, rootAlive }) => ({
          execId,
          groupId,
          groupKnown,
          members,
          rootPid,
          rootAlive,
        }),
      ),
    );
    setTimeout(() => {
      void round(
        'SIGKILL',
        targets.map(
          (
            { execId, groupId, leaderRunning, members, rootPid, rootAlive },
            index,
          ) => ({
            execId,
            groupId,
            groupKnown: leaderRunning?.() === true,
            members: Promise.all([term, members]).then(([seen, recorded]) => [
              ...(seen?.members[index] ?? []),
              ...(recorded ?? []),
            ]),
            rootPid,
            rootAlive,
          }),
        ),
      );
    }, SIGKILL_GRACE_MS).unref();
    await term;
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

let noSubreaperWarned = false;

/** Said once per daemon: the kernel refused the shim the subreaper. */
function warnNoSubreaper(error: string): void {
  if (noSubreaperWarned) return;
  noSubreaperWarned = true;
  console.warn(
    `[runnerd] the exec shim cannot become a subreaper (${error}): what an exec leaves is found by its group and tag alone`,
  );
}

const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
};
