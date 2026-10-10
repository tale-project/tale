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
 *    were queued behind the runaway body are re-sent, not failed. The
 *    deadline charges the authored code alone: the clock starts once the
 *    child has the scope in place and stops when it reports the evaluation
 *    finished, and its verdict waits for an answer already in the pipe.
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

import {
  type CodeRunner,
  type RunnerLimits,
  RunnerStopped,
} from '../core/runner';
import { probedExprSource, readProbedAnswer } from '../core/syntax/probe';
import { currentRunnerTenant } from './tenant';

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
   * process is killed (default 1000ms). vm's own `timeout` fires first for a
   * busy loop and yields its precise message; the kill is for bodies vm
   * cannot interrupt — an awaited continuation — and for a wedged process.
   * The grace is measured on the host's clock, so it also has to absorb a
   * starved child's scheduling delay and the IPC hop of its answer; it is
   * generous because a kill also fails every other evaluation in flight.
   */
  killGraceMs?: number;
  /**
   * The most runner processes at once (default 1). The pool starts with
   * one, adds another only when every process already holds `pipeline`
   * evaluations, and retires a process beyond the first once it has been
   * idle for `idleMs`.
   */
  processes?: number;
  /**
   * Evaluations handed to one process ahead of its answers (default 2). The
   * rest wait in the host, in one queue per tenant (`tenant.ts`), served in
   * turn — so a kill fails at most this many, and one organization's burst
   * cannot crowd out another's work.
   */
  pipeline?: number;
  /** How long a process beyond the first may sit without work before it is
   * retired (default five minutes). */
  idleMs?: number;
}

const DEFAULT_MAX_HEAP_MB = 512;
const DEFAULT_PIPELINE = 2;
const DEFAULT_IDLE_MS = 300_000;
const DEFAULT_KILL_GRACE_MS = 1000;
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
  /** Set once the process reported the evaluation complete; the answer is
   * on its way and the deadline no longer applies. */
  finished: boolean;
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

  /** Evaluations handed to this process and not yet answered. */
  get busy(): number {
    return this.pending.size;
  }

  /** Stop an idle process: nothing is lost, and the next evaluation would
   * start a fresh one. */
  retire(): void {
    if (this.pending.size > 0) return;
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
  }

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
        finished: false,
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
    if (message.finished === true) {
      entry.finished = true;
      if (entry.deadline !== null) clearTimeout(entry.deadline);
      entry.deadline = null;
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

  /** The deadline fired. It is a host timer, and after a stall of the host's
   * own event loop it fires BEFORE the poll phase that would deliver an
   * answer already sitting in the pipe — so the verdict waits one loop turn
   * for that answer (or the `finished` ack ahead of a large one) to be read.
   * Only an evaluation still unfinished after that is a runaway. */
  private overran(entry: Pending): void {
    entry.deadline = null;
    setImmediate(() => {
      if (!this.pending.has(entry.request.id) || entry.finished) return;
      this.kill(entry);
    });
  }

  /** A started evaluation outlived vm's own timeout: kill the process, fail
   * this evaluation, and let the others resume on a fresh process. */
  private kill(entry: Pending): void {
    this.settle(entry);
    entry.reject(
      new RunnerStopped(
        `evaluation timed out after ${entry.request.timeoutMs}ms; the node-vm runner process was killed`,
        { timedOut: true },
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
        entry.reject(new RunnerStopped(reason));
      } else if (entry.dispatches >= 2) {
        this.settle(entry);
        entry.reject(
          new RunnerStopped(
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
        entry.reject(new RunnerStopped(message));
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

/** One evaluation waiting in the host for a process with room. */
interface Job {
  readonly source: string;
  readonly async: boolean;
  readonly scopeJson: string;
  readonly limits: RunnerLimits;
  readonly resolve: (valueJson: string | null) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Up to `processes` runner processes, each exactly as one runner was before
 * (its deaths, kills and re-dispatches its own). An evaluation goes to the
 * process with the fewest in hand while one has room under `pipeline`;
 * otherwise it waits in its tenant's queue, and the queues are served in
 * turn as answers come back.
 */
class RunnerPool {
  private readonly processes: RunnerProcess[] = [];
  /** Waiting evaluations by tenant; the first entry is next in turn. */
  private readonly queues = new Map<string, Job[]>();
  private readonly idle = new Map<
    RunnerProcess,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private readonly options: {
      readonly maxHeapMb: number;
      readonly killGraceMs: number;
      readonly processes: number;
      readonly pipeline: number;
      readonly idleMs: number;
    },
  ) {}

  evaluate(
    source: string,
    async: boolean,
    scopeJson: string,
    limits: RunnerLimits,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      const tenant = currentRunnerTenant();
      const job: Job = { source, async, scopeJson, limits, resolve, reject };
      const queue = this.queues.get(tenant);
      if (queue === undefined) this.queues.set(tenant, [job]);
      else queue.push(job);
      this.dispatch();
    });
  }

  /** How many processes the pool runs now. */
  get size(): number {
    return this.processes.length;
  }

  /** Hand waiting evaluations to processes with room, one tenant at a time. */
  private dispatch(): void {
    for (;;) {
      const next = this.queues.entries().next();
      if (next.done === true) return;
      const target = this.room();
      if (target === null) return;
      const [tenant, queue] = next.value;
      const job = queue.shift();
      // The tenant moves to the back of the line, or leaves it when done.
      this.queues.delete(tenant);
      if (queue.length > 0) this.queues.set(tenant, queue);
      if (job !== undefined) this.start(target, job);
    }
  }

  /** The process with the fewest evaluations in hand (the first of equals)
   * when it has room; a new one when every process is full and the pool may
   * grow; otherwise none. */
  private room(): RunnerProcess | null {
    let best: RunnerProcess | null = null;
    for (const process of this.processes) {
      if (best === null || process.busy < best.busy) best = process;
    }
    if (best !== null && best.busy < this.options.pipeline) return best;
    if (this.processes.length < this.options.processes) {
      const added = new RunnerProcess(
        this.options.maxHeapMb,
        this.options.killGraceMs,
      );
      this.processes.push(added);
      return added;
    }
    return null;
  }

  private start(process: RunnerProcess, job: Job): void {
    const timer = this.idle.get(process);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.idle.delete(process);
    }
    void process
      .evaluate(job.source, job.async, job.scopeJson, job.limits)
      .then(job.resolve, (error: unknown) => {
        job.reject(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        // Its answer frees room: the next in turn goes, and an idle extra
        // process starts its clock.
        this.dispatch();
        this.idleLater(process);
      });
  }

  /** Retire a process beyond the first once it has been idle long enough. */
  private idleLater(process: RunnerProcess): void {
    if (process.busy > 0 || process === this.processes[0]) return;
    if (this.idle.has(process)) return;
    const timer = setTimeout(() => {
      this.idle.delete(process);
      if (process.busy > 0) return;
      const at = this.processes.indexOf(process);
      if (at > 0) this.processes.splice(at, 1);
      process.retire();
    }, this.options.idleMs);
    timer.unref();
    this.idle.set(process, timer);
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

/** The pool behind each runner this module made. */
const pools = new WeakMap<CodeRunner, RunnerPool>();

/** How many runner processes a node-vm runner holds now — for health
 * reports and the pool's own tests; undefined for another backend. */
export function runnerProcessCount(runner: CodeRunner): number | undefined {
  return pools.get(runner)?.size;
}

export function nodeVmRunner(opts: NodeVmRunnerOptions = {}): CodeRunner {
  const proc = new RunnerPool({
    maxHeapMb: opts.maxHeapMb ?? DEFAULT_MAX_HEAP_MB,
    killGraceMs: opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    processes: Math.max(1, Math.floor(opts.processes ?? 1)),
    pipeline: Math.max(1, Math.floor(opts.pipeline ?? DEFAULT_PIPELINE)),
    idleMs: opts.idleMs ?? DEFAULT_IDLE_MS,
  });
  const runner: CodeRunner = {
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
    // The same child, fresh context, deadline and kill as evalExpr: only the
    // source differs. A timeout or a dead process still rejects; an error the
    // expression throws comes back as data with the probes taken before it.
    async evalExprProbed(instrumented, scope, limits) {
      const keys = identifierKeys(scope);
      const answer = readProbedAnswer(
        await proc.evaluate(
          probedExprSource(instrumented, keys),
          false,
          JSON.stringify(scope),
          limits,
        ),
      );
      return {
        value: unwrapEnvelope(answer.valueJson),
        probes: answer.probes,
        ...(answer.error !== undefined && { error: answer.error }),
      };
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
  pools.set(runner, proc);
  return runner;
}
