/**
 * node:vm CodeRunner — the bundled backend, run in a SUPERVISED CHILD
 * PROCESS.
 *
 * Two different promises, kept apart on purpose:
 *
 *  - **The data-only calling convention** — the scope crosses into the vm
 *    context as a JSON round-trip (never live host references), the context
 *    has a null prototype and no code generation, and results come back as
 *    JSON. That is what makes tests exercise exactly the semantics the
 *    sandbox backend enforces for real.
 *  - **A fault boundary** — every body evaluates in `node-vm-child.ts`, a
 *    separate node process started with a V8 heap cap and killed by this
 *    supervisor when an evaluation overruns its deadline. A body that
 *    allocates without end, or parks itself inside `await`, takes down that
 *    process and nothing else; the supervisor rejects the evaluation with the
 *    reason and starts a fresh process for the next one. Evaluations that
 *    were queued behind the runaway body are re-sent, not failed.
 *
 * What it is NOT: a security boundary. The child runs as the same user, on
 * the same filesystem and network as the host, and node:vm itself is not an
 * isolation primitive — a determined payload can climb out of a vm context.
 * The out-of-process `sandbox-exec` backend is the security boundary; hosts
 * that run untrusted code live are expected to install it. Today the
 * platform hosts install THIS backend for transform bodies, template
 * expressions and connector mock bodies, and route only connector LIVE
 * bodies through the sandbox lane — so what this module buys them is that a
 * runaway or crashing body cannot take the shared API/worker process (and
 * every tenant on it) down with it.
 *
 * Syntax checks stay local: constructing a `vm.Script` parses without
 * executing, so no evaluation — and no process round-trip — is involved.
 */

import { type ChildProcess, fork } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import type { CodeRunner, RunnerLimits } from '../core/runner';

/** Runner construction options — the backend's public shape. @public */
export interface NodeVmRunnerOptions {
  /**
   * V8 old-space cap for the runner process, in megabytes (default 512).
   * Reaching it aborts the runner process — the evaluation fails with the
   * heap message, the host process is untouched.
   */
  maxHeapMb?: number;
  /**
   * How long past `limits.timeoutMs` a started evaluation may run before the
   * process is killed (default 250ms). vm's own `timeout` fires first for a
   * busy loop and yields its precise message; the kill is for bodies vm
   * cannot interrupt — an awaited continuation — and for a wedged process.
   */
  killGraceMs?: number;
}

const DEFAULT_MAX_HEAP_MB = 512;
const DEFAULT_KILL_GRACE_MS = 250;
/** How much of the runner's stderr to keep for the death notice — V8's
 * fatal-OOM banner is the first few lines. */
const STDERR_TAIL_BYTES = 4096;

const CHILD_PATH = fileURLToPath(
  new URL('./node-vm-child.ts', import.meta.url),
);

/** Scope keys become named function parameters; only identifier-safe keys
 * are engine-produced, so anything else is dropped rather than quoted. */
function identifierKeys(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

function argList(keys: string[]): string {
  return keys.map((k) => `__scope.${k}`).join(', ');
}

/** A single expression, wrapped so it evaluates to the `{v}` envelope as a
 * string — the stringify happens inside the context, so the data-only
 * convention holds for the result too. */
function exprSource(expr: string, keys: string[]): string {
  return `JSON.stringify({ v: (function(${keys.join(', ')}) { return (${expr}); })(${argList(keys)}) })`;
}

function syncBodySource(code: string, keys: string[]): string {
  return exprSource(`(function(){\n${code}\n})()`, keys);
}

/** An async body yields a promise of the same envelope. */
function asyncBodySource(code: string, keys: string[]): string {
  return `(async function(${keys.join(', ')}) {\n${code}\n})(${argList(keys)}).then(function (v) { return JSON.stringify({ v: v }); })`;
}

function unwrapEnvelope(valueJson: string | null): unknown {
  if (valueJson === null) return undefined;
  const parsed: unknown = JSON.parse(valueJson);
  return parsed !== null && typeof parsed === 'object' && 'v' in parsed
    ? parsed.v
    : undefined;
}

/** The node flags the runner process starts with. Type stripping lets node
 * run the child's TypeScript source directly (default from node 23.6; a flag
 * on the 22 line the backend ships on). Under Bun neither flag exists and
 * TypeScript runs natively — the heap cap is a V8 flag Bun accepts and
 * ignores, so on that runtime only the deadline kill applies. */
function childExecArgv(maxHeapMb: number): string[] {
  const args = [`--max-old-space-size=${maxHeapMb}`];
  if (!('bun' in process.versions)) {
    args.push(
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
    );
  }
  return args;
}

/** What the runner process inherits from the host's environment: enough to
 * find node and to evaluate dates and locales exactly as the host would —
 * nothing else. The host's secrets have no business in a process whose only
 * job is to evaluate authored code, even though the vm context itself never
 * exposes `process`. */
const CHILD_ENV_KEYS = ['PATH', 'TZ', 'LANG', 'LC_ALL'] as const;

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

interface ChildRequest {
  id: number;
  source: string;
  async: boolean;
  scopeJson: string;
  timeoutMs: number;
}

interface Pending {
  request: ChildRequest;
  /** Set once the process acknowledged it is running this request — from
   * then on the deadline clock ticks and a restart fails it. */
  started: boolean;
  /** How many processes this request was handed to. A request whose
   * process died before acknowledging it is re-sent once; a second such
   * death means the request itself is what kills the process (the ack
   * never left before the crash) and it fails instead of looping. */
  dispatches: number;
  deadline: ReturnType<typeof setTimeout> | null;
  resolve: (valueJson: string | null) => void;
  reject: (error: Error) => void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

/** Owns one runner process at a time: spawns it lazily, multiplexes
 * evaluations over its IPC channel, and replaces it when it dies or when an
 * evaluation overruns. */
class RunnerProcess {
  private child: ChildProcess | null = null;
  private ready = false;
  private stderrTail = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly maxHeapMb: number,
    private readonly killGraceMs: number,
  ) {}

  evaluate(
    source: string,
    async: boolean,
    scopeJson: string,
    limits: RunnerLimits,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      const id = this.nextId++;
      const entry: Pending = {
        request: { id, source, async, scopeJson, timeoutMs: limits.timeoutMs },
        started: false,
        dispatches: 0,
        deadline: null,
        resolve,
        reject,
      };
      this.pending.set(id, entry);
      this.ensureChild();
      if (this.ready) this.send(entry);
      this.updateRef();
    });
  }

  private ensureChild(): void {
    if (this.child !== null) return;
    const child = fork(CHILD_PATH, [], {
      execArgv: childExecArgv(this.maxHeapMb),
      env: childEnv(),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    });
    this.child = child;
    this.ready = false;
    this.stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(
        -STDERR_TAIL_BYTES,
      );
    });
    child.on('message', (message: unknown) => {
      if (this.child === child) this.onMessage(message);
    });
    child.on('error', (error: Error) => {
      if (this.child === child)
        this.onExit(`failed to start: ${error.message}`);
    });
    // 'close', not 'exit': it fires once the stderr pipe has drained too, so
    // the death notice can quote V8's fatal banner rather than race it.
    child.on('close', (code, signal) => {
      if (this.child === child) {
        this.onExit(signal ?? `exit code ${String(code)}`);
      }
    });
    // The process must never keep the host alive on its own; the channel is
    // ref'd only while an evaluation is pending (see updateRef).
    child.unref();
    // The stderr pipe is a net.Socket at runtime; typed as a Readable.
    if (child.stderr instanceof Socket) child.stderr.unref();
  }

  private send(entry: Pending): void {
    entry.dispatches += 1;
    this.child?.send(entry.request, (error) => {
      // A send that fails means the channel is gone; the exit handler
      // resolves what happens to the request. Nothing to do here but say so.
      if (error !== null) {
        console.warn(
          '[engine] node-vm runner: could not deliver an evaluation:',
          error.message,
        );
      }
    });
  }

  private onMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (message.ready === true) {
      this.ready = true;
      for (const entry of this.pending.values()) {
        if (!entry.started) this.send(entry);
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    if (message.started === true) {
      entry.started = true;
      entry.deadline = setTimeout(
        () => this.overran(entry),
        entry.request.timeoutMs + this.killGraceMs,
      );
      return;
    }
    this.settle(entry);
    if (message.ok === true) {
      entry.resolve(
        typeof message.valueJson === 'string' ? message.valueJson : null,
      );
    } else {
      entry.reject(
        new Error(
          typeof message.error === 'string'
            ? message.error
            : 'node-vm runner reported a failure without a message',
        ),
      );
    }
  }

  /** Forget a pending entry and its deadline. */
  private settle(entry: Pending): void {
    if (entry.deadline !== null) clearTimeout(entry.deadline);
    this.pending.delete(entry.request.id);
    this.updateRef();
  }

  /** A started evaluation outlived vm's own timeout: kill the process, fail
   * this evaluation, and let the others resume on a fresh process. */
  private overran(entry: Pending): void {
    this.settle(entry);
    entry.reject(
      new Error(
        `evaluation timed out after ${entry.request.timeoutMs}ms; the node-vm runner process was killed`,
      ),
    );
    this.replace(
      'the node-vm runner was restarted because another evaluation overran its deadline — retry',
    );
  }

  /** Drop the current process (killing it if it still runs). Started
   * evaluations fail with `reason`; queued ones move to the next process —
   * unless the last process died on them too, in which case they are the
   * runaway body and fail rather than crash a third process. */
  private replace(reason: string): void {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (
      child !== null &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill('SIGKILL');
    }
    for (const entry of this.pending.values()) {
      if (entry.started) {
        this.settle(entry);
        entry.reject(new Error(reason));
      } else if (entry.dispatches >= 2) {
        this.settle(entry);
        entry.reject(
          new Error(
            `the node-vm runner process died twice before acknowledging this evaluation — it exceeded the ${this.maxHeapMb}MB heap cap or crashed the process`,
          ),
        );
      }
    }
    if (this.pending.size > 0) {
      this.ensureChild();
      this.updateRef();
    }
  }

  private onExit(how: string): void {
    const fatal = this.stderrTail
      .split('\n')
      .find((line) => /FATAL ERROR|out of memory/i.test(line));
    const detail = fatal === undefined ? '' : `: ${fatal.trim()}`;
    if (!this.ready) {
      // Died before it could serve anything — a broken runtime, not a
      // runaway body. Fail everything rather than respawn in a loop.
      const startupTail = this.stderrTail.trim().split('\n').at(-1) ?? '';
      const message = `the node-vm runner process ${how}${detail}${startupTail && !fatal ? `: ${startupTail}` : ''}`;
      console.error('[engine] node-vm runner could not start:', message);
      this.child = null;
      for (const entry of this.pending.values()) {
        this.settle(entry);
        entry.reject(new Error(message));
      }
      return;
    }
    console.warn(
      `[engine] node-vm runner process died (${how}${detail}); restarting it`,
    );
    this.replace(
      `the node-vm runner process died while running this evaluation (${how}${detail}) — it exceeded the ${this.maxHeapMb}MB heap cap or crashed the process`,
    );
  }

  /** Hold the event loop open exactly while something is outstanding. */
  private updateRef(): void {
    const channel = this.child?.channel;
    if (channel === null || channel === undefined) return;
    if (this.pending.size > 0) channel.ref();
    else channel.unref();
  }
}

function checkSource(source: string): string | null {
  try {
    // Compile-only: constructing the script parses the source; nothing runs.
    const script = new vm.Script(source);
    void script;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function nodeVmRunner(opts: NodeVmRunnerOptions = {}): CodeRunner {
  const proc = new RunnerProcess(
    opts.maxHeapMb ?? DEFAULT_MAX_HEAP_MB,
    opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
  );
  return {
    // async so every failure — including a scope that cannot serialize —
    // reaches callers as a rejection, exactly like a wire-separated backend.
    async evalExpr(expr, scope, limits) {
      const keys = identifierKeys(scope);
      const valueJson = await proc.evaluate(
        exprSource(expr, keys),
        false,
        JSON.stringify(scope),
        limits,
      );
      return unwrapEnvelope(valueJson);
    },
    async runBody(code, scope, limits, bodyOpts) {
      const keys = identifierKeys(scope);
      const async = bodyOpts?.async === true;
      const valueJson = await proc.evaluate(
        async ? asyncBodySource(code, keys) : syncBodySource(code, keys),
        async,
        JSON.stringify(scope),
        limits,
      );
      return unwrapEnvelope(valueJson);
    },
    async checkExpr(expr) {
      return checkSource(`(${expr})`);
    },
    async checkBody(code, bodyOpts) {
      return checkSource(
        bodyOpts?.async === true
          ? `(async function(){\n${code}\n})`
          : `(function(){\n${code}\n})`,
      );
    },
    kind() {
      return 'node-vm';
    },
  };
}
