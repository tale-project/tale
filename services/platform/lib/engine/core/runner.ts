/**
 * The CodeRunner seam — the ONE interface every piece of untrusted
 * JavaScript in the engine runs behind: template expressions, transform
 * bodies, and connector mock/live bodies.
 *
 * Data-only in, data-only out: a scope crosses the boundary as plain JSON
 * and the result comes back the same way, so agent-authored code can never
 * hold a host reference. Everything is async because the production backend
 * executes in an isolated sandbox session over the wire; the bundled
 * `runners/node-vm.ts` fallback exists for tests and CI determinism and is
 * NOT a security boundary — hosts must install a real backend before running
 * untrusted code live.
 *
 * Syntax checking rides the same seam: validation wants "would this compile"
 * without executing anything, and only a backend has a parser.
 */

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

export interface CodeRunner {
  /** Evaluate a single JavaScript EXPRESSION against a data-only scope. */
  evalExpr(
    expr: string,
    scope: Record<string, unknown>,
    limits: RunnerLimits,
  ): Promise<unknown>;
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
      'no CodeRunner installed — call setCodeRunner() before validating or executing workflows',
    );
  }
  return runner;
}

/** Whether a runner is installed (validation degrades syntax checks to
 * "unchecked" rather than failing when the host wired none). */
export function hasCodeRunner(): boolean {
  return runner !== null;
}
