// Exec manager — spawns child processes for session execs and streams their
// stdout/stderr as NDJSON events. Byte-faithful and ordered: chunks are
// base64-encoded and emitted in arrival order so the platform-side agent
// adapters can reassemble JSONL without mid-line corruption.
//
// Each exec runs in its own process group (detached) so the timeout/cancel
// path can SIGTERM→SIGKILL the whole tree (a shell that forked rg/node/etc.).

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

import type { EnvStore } from './env-store.ts';
import {
  ID_ALPHABET_RE,
  RUNNERD_RING_BUFFER_BYTES,
  WORKSPACE_ROOT,
  type RunnerdExecEvent,
  type RunnerdExecRequest,
} from './protocol.ts';

const SIGKILL_GRACE_MS = 5_000;
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
}

export class ExecManager {
  private readonly live = new Map<string, LiveExec>();
  // Exited execs retained briefly so a reconnecting /attach can replay the
  // final ring + terminal event (insertion-ordered; oldest evicted past cap).
  private readonly recent = new Map<string, string[]>();

  constructor(
    private readonly envStore: EnvStore,
    private readonly onActivity: () => void,
  ) {}

  liveCount(): number {
    return this.live.size;
  }

  has(execId: string): boolean {
    return this.live.has(execId);
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
  attach(execId: string, emit: ExecSubscriber): Promise<void> | null {
    const liveRec = this.live.get(execId);
    if (liveRec) {
      for (const line of liveRec.ring) emitRingLine(line, emit);
      liveRec.subscribers.add(emit);
      return liveRec.done.finally(() => liveRec.subscribers.delete(emit));
    }
    const recentRing = this.recent.get(execId);
    if (recentRing) {
      for (const line of recentRing) emitRingLine(line, emit);
      return Promise.resolve();
    }
    return null;
  }

  private retainRecent(execId: string, ring: string[]): void {
    this.recent.set(execId, ring);
    while (this.recent.size > RECENT_EXEC_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  /** Resolve + validate the cwd. Must realpath to a path under the workspace
   * root and exist (no silent mkdir). Returns null on rejection.
   * TALE_WORKSPACE_ROOT overrides /workspace for hermetic unit tests. */
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
    let timedOut = false;
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
      kill: (signal) => {
        try {
          // Negative pid → signal the whole process group.
          if (child.pid !== undefined) process.kill(-child.pid, signal);
        } catch {
          // Already gone — nothing to kill.
        }
      },
    };
    this.live.set(req.execId, record);

    const ringEmit = (event: RunnerdExecEvent) => {
      emit(event);
      // Fan out to any concurrent /attach consumers.
      for (const sub of record.subscribers) {
        try {
          sub(event);
        } catch (err) {
          console.warn('[runnerd] attach subscriber threw:', err);
        }
      }
      const line = `${JSON.stringify(event)}\n`;
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

    if (req.stdinBase64) {
      try {
        child.stdin.end(Buffer.from(req.stdinBase64, 'base64'));
      } catch {
        // stdin may already be closed if the child exited instantly.
      }
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= req.stdoutMaxBytes) {
        stdoutTrunc = true;
        return;
      }
      stdoutBytes += chunk.byteLength;
      ringEmit({ t: 'stdout', b64: chunk.toString('base64') });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= req.stderrMaxBytes) {
        stderrTrunc = true;
        return;
      }
      stderrBytes += chunk.byteLength;
      ringEmit({ t: 'stderr', b64: chunk.toString('base64') });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      record.kill('SIGTERM');
      setTimeout(() => record.kill('SIGKILL'), SIGKILL_GRACE_MS);
    }, req.timeoutMs);

    await new Promise<void>((resolve) => {
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        record.exitCode = code;
        this.onActivity();
        ringEmit({
          t: 'exit',
          exitCode: code,
          durationMs: Date.now() - startedAtMs,
          truncated: { stdout: stdoutTrunc, stderr: stderrTrunc },
          timedOut,
          cancelled: record.cancelRequested,
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring);
        resolveDone();
        resolve();
      };
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ringEmit({
          t: 'fail',
          code: 'BAD_REQUEST',
          message: `spawn failed: ${err.message}`,
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring);
        resolveDone();
        resolve();
      });
      child.on('exit', (code, signal) => {
        // 128 + signal number is the conventional shell exit for a signal.
        const resolved =
          code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 15) : -1);
        finish(resolved);
      });
    });
  }

  /** SIGTERM→SIGKILL the exec's process group. Returns true if it was live. */
  cancel(execId: string): boolean {
    const rec = this.live.get(execId);
    if (!rec) return false;
    rec.cancelRequested = true;
    rec.kill('SIGTERM');
    setTimeout(() => rec.kill('SIGKILL'), SIGKILL_GRACE_MS);
    return true;
  }

  status(execId: string): { state: 'running'; startedAtMs: number } | null {
    const rec = this.live.get(execId);
    if (!rec) return null;
    return { state: 'running', startedAtMs: rec.startedAtMs };
  }
}

/** Parse a retained ring line (NDJSON) back to an event for attach replay. */
function emitRingLine(line: string, emit: ExecSubscriber): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    // Lines were produced by ringEmit (JSON.stringify of a RunnerdExecEvent),
    // so the shape is ours, not external input.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    emit(JSON.parse(trimmed) as RunnerdExecEvent);
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
