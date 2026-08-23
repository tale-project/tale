/**
 * node:vm CodeRunner — the bundled fallback backend for tests and CI
 * determinism.
 *
 * node:vm is NOT a security boundary: a determined payload can escape a vm
 * context. What this backend DOES guarantee is the engine's data-only
 * calling convention — the scope crosses into the context as a JSON
 * round-trip (never live host references), the context has a null
 * prototype, and results come back as JSON — so tests exercise exactly the
 * semantics the production sandbox backend enforces for real. Hosts must
 * install that real backend before executing untrusted code live; the
 * assembly seam makes not doing so an explicit choice.
 */

import vm from 'node:vm';

import type { CodeRunner, RunnerLimits } from '../core/runner';

/** Scope keys become named function parameters; only identifier-safe keys
 * are engine-produced, so anything else is dropped rather than quoted. */
function identifierKeys(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

function run(
  source: string,
  scope: Record<string, unknown>,
  limits: RunnerLimits,
): unknown {
  const keys = identifierKeys(scope);
  // The JSON round-trip is the data-only convention, not an optimization:
  // functions, class instances, and prototypes never cross, matching what a
  // wire-separated sandbox can even receive.
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `JSON.stringify({ v: (function(${keys.join(', ')}) { return (${source}); })(${keys
      .map((k) => `__scope.${k}`)
      .join(', ')}) })`,
  );
  // Defined via the context object so the scope itself is data the script
  // reads, not a host binding.
  vm.runInContext(`__scope = ${JSON.stringify(scope)}`, context, {
    timeout: limits.timeoutMs,
  });
  const out = script.runInContext(context, { timeout: limits.timeoutMs });
  if (out === undefined || out === null) return undefined;
  const parsed: unknown = JSON.parse(String(out));
  return parsed !== null && typeof parsed === 'object' && 'v' in parsed
    ? parsed.v
    : undefined;
}

/**
 * The async counterpart of {@link run}: the body is wrapped in an async
 * function, so the script yields a promise. It resolves to the SAME
 * JSON envelope the sync path produces — the stringify happens inside the
 * context, so the data-only convention holds for async bodies too.
 *
 * The `timeout` option only bounds synchronous execution; it cannot interrupt
 * an awaited continuation. That is one more reason this backend is documented
 * as a test/CI fallback rather than a boundary — a real sandbox enforces the
 * wall clock out of process.
 */
async function runAsync(
  source: string,
  scope: Record<string, unknown>,
  limits: RunnerLimits,
): Promise<unknown> {
  const keys = identifierKeys(scope);
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const script = new vm.Script(
    `(async function(${keys.join(', ')}) {\n${source}\n})(${keys
      .map((k) => `__scope.${k}`)
      .join(', ')}).then(function (v) { return JSON.stringify({ v: v }); })`,
  );
  vm.runInContext(`__scope = ${JSON.stringify(scope)}`, context, {
    timeout: limits.timeoutMs,
  });
  const pending: unknown = script.runInContext(context, {
    timeout: limits.timeoutMs,
  });
  const out: unknown = await pending;
  // The in-context `then` always resolves to the JSON envelope; anything else
  // means the body resolved to nothing serializable.
  if (typeof out !== 'string') return undefined;
  const parsed: unknown = JSON.parse(out);
  return parsed !== null && typeof parsed === 'object' && 'v' in parsed
    ? parsed.v
    : undefined;
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

export function nodeVmRunner(): CodeRunner {
  return {
    // async so every failure — including synchronous vm throws — reaches
    // callers as a rejection, exactly like a wire-separated backend.
    async evalExpr(expr, scope, limits) {
      return run(expr, scope, limits);
    },
    async runBody(code, scope, limits, opts) {
      return opts?.async === true
        ? await runAsync(code, scope, limits)
        : run(`(function(){\n${code}\n})()`, scope, limits);
    },
    async checkExpr(expr) {
      return checkSource(`(${expr})`);
    },
    async checkBody(code, opts) {
      return checkSource(
        opts?.async === true
          ? `(async function(){\n${code}\n})`
          : `(function(){\n${code}\n})`,
      );
    },
    kind() {
      return 'node-vm';
    },
  };
}
