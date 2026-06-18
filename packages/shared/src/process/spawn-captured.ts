/**
 * Spawn a child process with its output CAPTURED (piped), never inherited.
 *
 * This is the single fix for the pollution: every line of stdout+stderr is run
 * through a {@link Classifier}, stamped with a receipt time, retained in a ring
 * buffer (for `--verbose` / failure dumps), and handed to `onClassified` — which
 * the renderer drains on a timer so the child's write rate never drives the
 * paint rate (and never back-pressures the OS pipe into stalling the child).
 *
 * Unifies the two runtimes: the CLI uses Bun.spawn; the dev orchestrator uses
 * node `child_process` (so its `tree-kill` reaches the `npx`→node→backend and
 * vite-worker grandchildren). Both `cmd`/`now`/`treeKill`/`write` are injectable
 * so the supervisor is testable without real timers or a real terminal.
 *
 * CLI/script-only — value-imports `node:child_process` and uses `Bun`, so it
 * must never be reachable from `@tale/shared/logging/logger` (Convex V8).
 */

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';

import type { ClassifiedLine, Classifier } from '../classify';
import { pipeLines, pipeNodeStream } from './pipe-lines';
import { RingBuffer } from './ring-buffer';

export type SpawnBackend = 'bun' | 'node';

export interface SpawnCapturedOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  /**
   * Full child environment. When set it REPLACES (never merges — pass a complete
   * set); when omitted the child inherits the parent `process.env`. Both backends
   * behave identically here.
   */
  env?: Record<string, string | undefined>;
  backend?: SpawnBackend;
  classifier?: Classifier;
  /** Live consumer of classified lines (e.g. a task handle or the steady-state view). */
  onClassified?: (line: ClassifiedLine) => void;
  /** Also write every raw line straight through (the `--verbose` passthrough). */
  verbose?: boolean;
  /** Raw-line ring capacity. */
  ringSize?: number;
  /** Only `'inherit'` is sanctioned, narrowly for a sudo-password prompt. */
  stdin?: 'ignore' | 'inherit';
  /** Monotonic clock for `receivedAt`; injectable for tests. */
  now?: () => number;
  /** Injected tree-kill `(pid, signal)`; the dev orchestrator passes the real one. */
  treeKill?: (pid: number, signal: string) => Promise<void> | void;
  /** Raw passthrough sink for verbose mode; defaults to `process.stdout`. */
  write?: (chunk: string) => void;
  /**
   * Sink for a best-effort-teardown diagnostic (a `kill` that failed against an
   * already-dead child, etc.). Defaults to `process.stderr`, but a live-region
   * owner injects its own so the message routes through the single writer
   * instead of corrupting the region.
   */
  onError?: (message: string) => void;
}

export interface CapturedProcess {
  readonly pid: number | undefined;
  /** Snapshot of the retained raw lines (oldest-first). */
  ring(): readonly string[];
  /**
   * Resolves with the exit code once the process has exited AND its streams have
   * drained. REJECTS if the child fails to spawn at all (e.g. ENOENT — command
   * not found), since there is no exit code in that case.
   */
  exited: Promise<number>;
  /** Tree-kill the whole subtree (SIGTERM by default). Best-effort, never throws. */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

const passthrough: Classifier = (line) => ({
  kind: 'info',
  text: line,
  raw: line,
  source: 'generic',
});

function defaultWrite(chunk: string): void {
  if (typeof process !== 'undefined') process.stdout.write(chunk);
}

function defaultOnError(message: string): void {
  if (typeof process !== 'undefined') process.stderr.write(`${message}\n`);
}

export function spawnCaptured(opts: SpawnCapturedOptions): CapturedProcess {
  const {
    cmd,
    args = [],
    cwd,
    env,
    backend = 'bun',
    classifier = passthrough,
    onClassified,
    verbose = false,
    ringSize = 1000,
    stdin = 'ignore',
    now = () => Date.now(),
    treeKill,
    write = defaultWrite,
    onError = defaultOnError,
  } = opts;

  const ring = new RingBuffer<string>(ringSize);

  const handleLine = (line: string): void => {
    const classified = classifier(line);
    classified.receivedAt = now();
    ring.push(classified.raw);
    if (verbose) write(`${line}\n`);
    onClassified?.(classified);
  };

  let pid: number | undefined;
  let exitCode = 0;
  let exited: Promise<number>;
  let killImpl: (signal: NodeJS.Signals) => void;

  if (backend === 'node') {
    const child: ChildProcess = nodeSpawn(cmd, args, {
      cwd,
      // `env` undefined → node inherits process.env (same as the Bun backend).
      env,
      stdio: [stdin === 'inherit' ? 'inherit' : 'ignore', 'pipe', 'pipe'],
    });
    pid = child.pid;
    const pipes: Promise<void>[] = [];
    if (child.stdout) pipes.push(pipeNodeStream(child.stdout, handleLine));
    if (child.stderr) pipes.push(pipeNodeStream(child.stderr, handleLine));
    const exitPromise = new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => {
        exitCode = code ?? 0;
        resolve(exitCode);
      });
      child.on('error', reject);
    });
    exited = Promise.all([...pipes, exitPromise]).then(() => exitCode);
    killImpl = (signal) => {
      child.kill(signal);
    };
  } else {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: stdin === 'inherit' ? 'inherit' : 'ignore',
    });
    pid = proc.pid;
    const pipes = [
      pipeLines(proc.stdout as ReadableStream<Uint8Array>, handleLine),
      pipeLines(proc.stderr as ReadableStream<Uint8Array>, handleLine),
    ];
    const exitPromise = proc.exited.then((code) => {
      exitCode = code;
      return code;
    });
    exited = Promise.all([...pipes, exitPromise]).then(() => exitCode);
    killImpl = (signal) => {
      proc.kill(signal);
    };
  }

  const kill = async (signal: NodeJS.Signals = 'SIGTERM'): Promise<void> => {
    try {
      if (treeKill && pid !== undefined) {
        await treeKill(pid, signal);
        return;
      }
      killImpl(signal);
    } catch (err) {
      // Best-effort teardown: a kill against an already-dead child is benign,
      // but surface anything unexpected for diagnosis rather than swallowing it.
      // Routed through the injected sink so it never corrupts a live region.
      onError(
        `spawnCaptured kill(${signal}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    pid,
    ring: () => ring.toArray(),
    exited,
    kill,
  };
}
