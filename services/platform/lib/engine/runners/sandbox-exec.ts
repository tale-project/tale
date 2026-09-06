/**
 * sandbox-exec CodeRunner — the real execution boundary for untrusted
 * JavaScript.
 *
 * Every template expression, transform body, and connector mock/live body an
 * agent authors is untrusted. The bundled `node-vm` backend runs those bodies
 * in a supervised child process on the same host and is honest that it is a
 * fault boundary, not a security boundary: a determined payload can climb out
 * of a vm context into a process that shares the host's user, filesystem and
 * network. This backend closes that gap by running the body in the platform's
 * isolated per-org sandbox session, reached through an injected transport:
 *
 *  - **Isolated** — the code never executes on the engine's host, so an
 *    escape lands in a disposable sandbox rather than next to the platform.
 *  - **A hard, killable deadline** — `limits.timeoutMs` crosses to the
 *    transport on every run, and the transport enforces it by KILLING the
 *    sandbox process when it overruns. A body wedged inside `await` is bounded
 *    exactly like a busy loop.
 *  - **Data-only, preserved exactly** — the scope crosses as JSON and the
 *    result returns as JSON, so agent code can never hold a host reference: a
 *    function, socket, or prototype simply is not representable on the wire.
 *    The JSON round-trip is the boundary, not an optimization.
 *
 * The engine core must stay pure (no `node:*`, no Bun, no Convex — see
 * `selftest/purity.test.ts`), so this module imports nothing but the seam's
 * types and talks to the sandbox ONLY through the injected `SandboxExecTransport`.
 * The host builds a real transport from a live session and installs the backend
 * with `setCodeRunner(...)` at assembly time; tests drive the exact same runner
 * with a fake transport.
 */

import type { CodeRunner, RunnerLimits } from '../core/runner';

// --------------------------------------------------------------- the seam

/** One evaluation, shipped to the sandbox. */
export interface SandboxExecRequest {
  /**
   * A JavaScript EXPRESSION that evaluates to the JSON result envelope
   * `{"v": <result>}` as a STRING — or, for an async body, a Promise of that
   * string. It reads the data-only scope from a `__scope` binding the transport
   * makes available before running. The `JSON.stringify` that forms the
   * envelope runs INSIDE the sandbox, so a function or prototype in the result
   * is stripped there and never reaches the host.
   */
  code: string;
  /**
   * The scope, already serialized to JSON. Handed over as a SEPARATE channel
   * rather than spliced into `code`: data is data and code is code, so the
   * transport is free to deliver it however a real sandbox prefers (inlined,
   * staged as a file, piped over stdin) and the runner stays agnostic.
   */
  scopeJson: string;
  /** The wall-clock cap the transport MUST enforce as a hard, killable deadline. */
  limits: RunnerLimits;
}

/**
 * What the sandbox reports back. `ok` carries the result envelope verbatim; a
 * failure — a syntax/runtime throw, a non-zero exit, or a deadline kill —
 * carries a human-readable reason. A transport NEVER resolves `ok: true` with
 * an empty or absent envelope; "no result" is a failure, so the runner can
 * refuse to invent one.
 */
export type SandboxExecResult =
  | { ok: true; valueJson: string }
  | { ok: false; error: string };

/**
 * Ships one request to the sandbox session and resolves its outcome. Injected
 * so the runner carries no `'use node'`/Convex code and is unit-testable with a
 * fake. A thrown promise (a dead session, a network fault) is honest failure —
 * the runner turns it into a rejection, never a silent empty result.
 */
export type SandboxExecTransport = (
  request: SandboxExecRequest,
) => Promise<SandboxExecResult>;

/** Runner construction options — the backend's public shape. @public */
export interface SandboxExecRunnerOptions {
  /**
   * Reject a scope whose serialized form exceeds this many bytes BEFORE it
   * reaches the transport. An out-of-process boundary has a real payload
   * ceiling; failing fast with a clear message beats a downstream transport
   * error. Unset means no ceiling (parity with the in-process fallback).
   */
  maxScopeBytes?: number;
}

// --------------------------------------------------- data-only calling convention

/**
 * Scope keys become named function parameters, so a body reads `input`, not
 * `__scope.input`. Only identifier-safe keys are engine-produced, so anything
 * else is dropped rather than quoted in — mirroring the fallback backend so the
 * two enforce byte-for-byte the same convention.
 */
function identifierKeys(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

/** `input, ctx` — the bound scope keys as a parameter list. */
function paramList(keys: string[]): string {
  return keys.join(', ');
}

/** `__scope.input, __scope.ctx` — the same keys read off the injected scope. */
function argList(keys: string[]): string {
  return keys.map((k) => `__scope.${k}`).join(', ');
}

/** A single expression, wrapped so it returns the `{v}` envelope as a string. */
function buildExprSource(expr: string, keys: string[]): string {
  return `JSON.stringify({ v: (function (${paramList(keys)}) { return (${expr}); })(${argList(keys)}) })`;
}

/** A synchronous function body (must `return`), wrapped the same way. */
function buildSyncBodySource(code: string, keys: string[]): string {
  return `JSON.stringify({ v: (function (${paramList(keys)}) {\n${code}\n})(${argList(keys)}) })`;
}

/**
 * An async body: the wrapper is an async IIFE, so the expression evaluates to a
 * Promise of the envelope. The `JSON.stringify` runs after the body resolves,
 * inside the sandbox, so the data-only convention holds for async results too.
 */
function buildAsyncBodySource(code: string, keys: string[]): string {
  return `(async function (${paramList(keys)}) {\n${code}\n})(${argList(keys)}).then(function (__v) { return JSON.stringify({ v: __v }); })`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeScope(
  scope: Record<string, unknown>,
  maxScopeBytes: number | undefined,
): string {
  let scopeJson: string;
  try {
    scopeJson = JSON.stringify(scope);
  } catch (cause) {
    // A cyclic or otherwise non-serializable scope can't cross a data-only
    // boundary at all — say so plainly instead of shipping a broken payload.
    throw new Error(
      `sandbox-exec cannot serialize the scope to JSON: ${messageOf(cause)}`,
      { cause },
    );
  }
  if (maxScopeBytes !== undefined && scopeJson.length > maxScopeBytes) {
    throw new Error(
      `sandbox-exec scope is ${scopeJson.length} bytes, over the ${maxScopeBytes}-byte per-run limit`,
    );
  }
  return scopeJson;
}

/** Parse the result envelope and unwrap `v`. An envelope without `v` is the
 * legitimate "returned undefined" case (JSON drops an `undefined` value), never
 * an error. */
function unwrapEnvelope(valueJson: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch (cause) {
    throw new Error(
      `sandbox-exec returned a result that is not JSON: ${valueJson.slice(0, 200)}`,
      { cause },
    );
  }
  return parsed !== null && typeof parsed === 'object' && 'v' in parsed
    ? parsed.v
    : undefined;
}

/** Run one request through the transport and turn its outcome into the value or
 * a rejection. Every failure mode — a thrown transport, a reported failure, an
 * unparseable envelope — becomes a rejection with a clear message, so a caller
 * never mistakes a dead session for an empty result. */
async function runThroughTransport(
  transport: SandboxExecTransport,
  request: SandboxExecRequest,
): Promise<unknown> {
  let result: SandboxExecResult;
  try {
    result = await transport(request);
  } catch (cause) {
    throw new Error(`sandbox-exec transport failed: ${messageOf(cause)}`, {
      cause,
    });
  }
  if (!result.ok) {
    throw new Error(`sandbox-exec run failed: ${result.error}`);
  }
  return unwrapEnvelope(result.valueJson);
}

// ------------------------------------------------------------ compile checks

/**
 * The AsyncFunction constructor is not a global; reach it through an async
 * function's prototype chain. Used only to PARSE an async body — the compiled
 * function is never invoked.
 */
const AsyncFunction: FunctionConstructor = Object.getPrototypeOf(
  async function () {
    /* probe only */
  },
).constructor;

/**
 * Compile-only syntax check. Constructing a function PARSES its source and
 * throws a SyntaxError on malformed input, but runs NOTHING — the compiled
 * function is discarded, never called. Because it executes no user code, it
 * needs no sandbox: the check stays LOCAL, which avoids a session round-trip on
 * every validation and keeps validation working when no live session exists.
 * This is the same in-process parse the fallback backend performs, and it is
 * safe for the same reason: parsing cannot escape.
 */
function parseOnly(source: string, async: boolean): void {
  // Compile-only parse: `compiled` is discarded and never invoked, so no
  // untrusted code runs — constructing it only forces a syntax check, the same
  // guarantee node-vm's `new vm.Script` gives, which is why the check stays
  // local rather than riding the sandbox.
  // oxlint-disable-next-line typescript/no-implied-eval -- compile-only parse, discarded, never invoked
  const compiled = async ? new AsyncFunction(source) : new Function(source); // nosemgrep: tools.opengrep.ts-no-new-function
  void compiled;
}

function checkSyntax(source: string, async: boolean): string | null {
  try {
    parseOnly(source, async);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Build the sandbox-exec backend from a transport.
 *
 * The host installs it with `setCodeRunner(createSandboxExecRunner(transport))`
 * at assembly time; see {@link createSessionTransport} for turning a real
 * session into that transport.
 */
export function createSandboxExecRunner(
  transport: SandboxExecTransport,
  opts: SandboxExecRunnerOptions = {},
): CodeRunner {
  const { maxScopeBytes } = opts;
  return {
    async evalExpr(expr, scope, limits) {
      const scopeJson = serializeScope(scope, maxScopeBytes);
      return runThroughTransport(transport, {
        code: buildExprSource(expr, identifierKeys(scope)),
        scopeJson,
        limits,
      });
    },
    async runBody(code, scope, limits, bodyOpts) {
      const scopeJson = serializeScope(scope, maxScopeBytes);
      const keys = identifierKeys(scope);
      const source =
        bodyOpts?.async === true
          ? buildAsyncBodySource(code, keys)
          : buildSyncBodySource(code, keys);
      return runThroughTransport(transport, {
        code: source,
        scopeJson,
        limits,
      });
    },
    async checkExpr(expr) {
      // Wrapped as a returned expression so a bare value parses as an
      // expression, matching how `evalExpr` runs it.
      return checkSyntax(`return (${expr});`, false);
    },
    async checkBody(code, bodyOpts) {
      return checkSyntax(code, bodyOpts?.async === true);
    },
    kind() {
      return 'sandbox-exec';
    },
  };
}

// ------------------------------------- building a transport from a session

/**
 * The delimiters the in-sandbox program brackets its result envelope with on
 * stdout. `createSessionTransport` extracts the JSON between them, so a body
 * that also writes to stdout (a stray `console.log`) cannot corrupt the result.
 * Exported so a host — or a test — can recognize the result line.
 */
export const SANDBOX_RESULT_OPEN = '<<TALE_RUNNER_RESULT<<';
export const SANDBOX_RESULT_CLOSE = '>>TALE_RUNNER_RESULT>>';

/**
 * Runs one self-contained JS program in the isolated sandbox session under a
 * HARD wall-clock deadline and reports how it ended. The integrator supplies
 * this from a real session (staging the program and running `node` through the
 * session client). Its contract is the reason this backend is a boundary at
 * all: it MUST forcibly kill a run that overruns `timeoutMs` — an overrun is
 * surfaced as `timedOut`, a crash as a non-zero `exitCode`, neither is thrown.
 * A genuine transport fault (a dead or unreachable session) DOES throw, so the
 * runner can report it honestly.
 */
export type SandboxProgramRunner = (
  program: string,
  timeoutMs: number,
) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}>;

/** Assemble the runnable program: bind the scope, evaluate the runner's
 * envelope expression, and bracket the result on stdout. Written as an ES
 * module (no top-level `return`), deferring the body into a `then` so a
 * synchronous throw and an async rejection travel the one error path. */
function buildSandboxProgram(code: string, scopeJson: string): string {
  return [
    // The scope is embedded as a STRING LITERAL and parsed — data, never code.
    `const __scope = JSON.parse(${JSON.stringify(scopeJson)});`,
    `Promise.resolve()`,
    `  .then(function () { return (`,
    code,
    `  ); })`,
    `  .then(`,
    `    function (__result) { process.stdout.write(${JSON.stringify(SANDBOX_RESULT_OPEN)} + __result + ${JSON.stringify(SANDBOX_RESULT_CLOSE)}); },`,
    `    function (__error) {`,
    `      process.stderr.write('sandbox-exec body error: ' + (__error && __error.stack ? __error.stack : String(__error)));`,
    `      process.exitCode = 1;`,
    `    },`,
    `  );`,
  ].join('\n');
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return (newline === -1 ? text : text.slice(0, newline)).trim().slice(0, 500);
}

function extractResultEnvelope(stdout: string): string | null {
  // The real emit runs last (after any body output), so the LAST bracketed
  // block is the true result.
  const open = stdout.lastIndexOf(SANDBOX_RESULT_OPEN);
  if (open === -1) return null;
  const from = open + SANDBOX_RESULT_OPEN.length;
  const close = stdout.indexOf(SANDBOX_RESULT_CLOSE, from);
  if (close === -1) return null;
  return stdout.slice(from, close);
}

/**
 * Turn a raw {@link SandboxProgramRunner} into a {@link SandboxExecTransport} —
 * the small piece of glue the integrator needs. It owns the whole wire
 * protocol (assembling the program, delivering the scope, extracting the
 * result), so the host only supplies the session's run primitive and then wires
 * the backend at assembly time:
 *
 * ```ts
 * setCodeRunner(createSandboxExecRunner(createSessionTransport(runInSession)));
 * ```
 */
export function createSessionTransport(
  runProgram: SandboxProgramRunner,
): SandboxExecTransport {
  return async ({ code, scopeJson, limits }) => {
    const program = buildSandboxProgram(code, scopeJson);
    // A transport fault (dead session) throws out of here on purpose — the
    // runner wraps it as a clear rejection.
    const run = await runProgram(program, limits.timeoutMs);
    if (run.timedOut) {
      return {
        ok: false,
        error: `run exceeded the ${limits.timeoutMs}ms wall-clock deadline; the sandbox process was killed`,
      };
    }
    if (run.exitCode !== null && run.exitCode !== 0) {
      const detail = firstLine(run.stderr);
      return {
        ok: false,
        error: `sandbox process exited with code ${run.exitCode}${detail ? `: ${detail}` : ''}`,
      };
    }
    const envelope = extractResultEnvelope(run.stdout);
    if (envelope === null) {
      const detail = firstLine(run.stderr);
      return {
        ok: false,
        error: `sandbox produced no result${detail ? ` (stderr: ${detail})` : ''}`,
      };
    }
    return { ok: true, valueJson: envelope };
  };
}
