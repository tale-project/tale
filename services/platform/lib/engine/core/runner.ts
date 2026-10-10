/**
 * The CodeRunner seam — the ONE interface every piece of untrusted
 * JavaScript in the engine runs behind: template expressions, transform
 * bodies, and connector mock/live bodies.
 *
 * Data-only in, data-only out: a scope crosses the boundary as plain JSON
 * and the result comes back the same way, so agent-authored code can never
 * hold a host reference. Everything is async because every backend executes
 * out of the engine's process: `runners/sandbox-exec.ts` in the platform's
 * isolated sandbox session over the wire — the security boundary — and the
 * bundled `runners/node-vm.ts` in a supervised child process with a heap cap
 * and a deadline kill — a FAULT boundary only (a runaway body cannot take the
 * host down), NOT a security boundary. Hosts must install the sandbox backend
 * before running untrusted code live.
 *
 * Syntax checking rides the same seam: validation wants "would this compile"
 * without executing anything, and only a backend has a parser.
 */

import type { ValueSummary } from '@tale/ui/data/value-summary';

export interface RunnerLimits {
  /** Wall-clock cap for one evaluation. Backends enforce it hard. */
  timeoutMs: number;
}

/**
 * Whether the body may use `await` at its top level.
 *
 * Transform bodies are synchronous by contract — they reshape data and cannot
 * reach the network, so awaiting has nothing to await. Connector LIVE bodies
 * are the opposite: they exist to call an API, so `await ctx.http.get(...)` is
 * their normal shape. A body compiled as synchronous rejects that `await` as a
 * syntax error, so the caller declares which kind it is passing.
 */
export interface BodyOptions {
  /** Compile/run the body inside an async function. Default false. */
  async?: boolean;
}

/**
 * What an instrumented expression answered: its value (as {@link
 * CodeRunner.evalExpr} would have answered it) or the error it threw, and the
 * summary of every probed sub-expression it evaluated, by probe index.
 */
export interface ProbedResult {
  value: unknown;
  probes: Array<[number, ValueSummary]>;
  /** The expression threw: the thrown value as text, and its `name` when it
   * had one. The probes are the ones taken until the throw. */
  error?: { message: string; name?: string };
}

/**
 * The runner itself stopped an evaluation: it killed the process that ran it
 * past its deadline, or that process died (out of memory, a crash), or the
 * session it runs in could not be reached. Never the expression's own error.
 * An evaluation that ended this way is not tried again — the same source
 * would meet the same end, and a second death costs every evaluation that
 * shares the runner.
 */
export class RunnerStopped extends Error {
  /** The runner stopped this evaluation because it outlived its deadline
   * (and replaced the process it ran in), not because the runner broke. */
  readonly timedOut: boolean;
  constructor(
    message: string,
    options?: { cause?: unknown; timedOut?: boolean },
  ) {
    super(message, options);
    this.name = 'RunnerStopped';
    this.timedOut = options?.timedOut === true;
  }
}

export interface CodeRunner {
  /** Evaluate a single JavaScript EXPRESSION against a data-only scope. */
  evalExpr(
    expr: string,
    scope: Record<string, unknown>,
    limits: RunnerLimits,
  ): Promise<unknown>;
  /**
   * Evaluate an expression instrumented with probes (`syntax/probe.ts`) in
   * the wrapper `probedExprSource` builds, with the same isolation and limits
   * as {@link evalExpr}. An error the expression throws is answered, not
   * thrown; an evaluation the runner itself stops — a timeout, a runner that
   * died — still rejects. Optional: without it, conditions are evaluated
   * plainly and their sub-expression values are not recorded.
   */
  evalExprProbed?(
    instrumented: string,
    scope: Record<string, unknown>,
    limits: RunnerLimits,
  ): Promise<ProbedResult>;
  /** Run a function BODY (must `return`) against a data-only scope. */
  runBody(
    code: string,
    scope: Record<string, unknown>,
    limits: RunnerLimits,
    opts?: BodyOptions,
  ): Promise<unknown>;
  /** Compile-only check of an expression; the syntax error message, or null
   * when it parses. */
  checkExpr(expr: string): Promise<string | null>;
  /** Compile-only check of a function body. */
  checkBody(code: string, opts?: BodyOptions): Promise<string | null>;
  /** Backend identity for diagnostics ("sandbox-exec", "node-vm"). */
  kind(): string;
}

let runner: CodeRunner | null = null;

/** Install the runner backend. Hosts call this once at assembly time. */
export function setCodeRunner(backend: CodeRunner): void {
  runner = backend;
}

/** The installed runner. Throwing (rather than a silent default) keeps an
 * unassembled engine from ever executing untrusted code with no boundary. */
export function codeRunner(): CodeRunner {
  if (!runner) {
    throw new Error(
      'no CodeRunner installed — call setCodeRunner() before validating or executing automations',
    );
  }
  return runner;
}

/** Whether a runner is installed (validation degrades syntax checks to
 * "unchecked" rather than failing when the host wired none). */
export function hasCodeRunner(): boolean {
  return runner !== null;
}
