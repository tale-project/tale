/**
 * The host-capable in-process CodeRunner for the SHIPPED connector catalog's
 * live yaml-js bodies.
 *
 * A live body needs the mediated host in hand — `ctx.http` (the allowlisted,
 * SSRF-policed fetch), `ctx.secrets.get`, `ctx.files` — and those are
 * functions. The bundled node-vm runner is data-only by contract (its scope
 * crosses as JSON), so it can never carry them; the sandbox-exec runner
 * carries them by round-tripping every call to the host-call endpoint, but
 * only a caller that owns a sandbox session can use it. Automation runs and
 * chat own none, which left every live yaml-js action refusing outside the
 * bridge.
 *
 * TRUST: this runner is NOT a security boundary and must only ever run the
 * catalog under `configs/platform/system/connectors/` — code that ships with
 * the platform, is validated at boot, and is identical in every deployment.
 * No organization can upload or edit a connector body (packs carry
 * workflows and skills, never connectors), so a body here is as trusted as
 * the native backends beside it. Untrusted code — transforms, expressions,
 * anything agent- or user-authored — stays on the data-only runner or in
 * the sandbox; this module's `runBody` only accepts the async live shape and
 * hands everything else to the data-only backend.
 *
 * TIME LIMIT: `limits.timeoutMs` bounds the CALLER's wait, not the body. In
 * this realm there is no isolate to tear down, so a body whose await
 * outlives the deadline keeps running in the backend process until that
 * await settles, and its result is dropped. What it can still do is bounded
 * by the host it holds — every `ctx.http` call goes through the policed live
 * host with its own per-request timeout, `ctx.files` writes to the org's own
 * store — so an overrun costs a request slot and some memory, never a policy.
 * Cancelling the body itself (an AbortSignal threaded into the live host's
 * fetch) is not wired; a catalog body is expected to make one or a few
 * bounded vendor calls.
 */

import vm from 'node:vm';

import type { CodeRunner, RunnerLimits } from '../engine/core/runner';
import { nodeVmRunner } from '../engine/runners/node-vm';

/** What `CodeRunner.kind()` answers — the dispatcher selects on it. */
export const IN_PROCESS_LIVE_RUNNER_KIND = 'in-process-live';

type LiveBody = (...args: unknown[]) => Promise<unknown>;

/** Scope keys become named parameters; the dispatcher passes `input` and
 * `ctx`, and only identifier-safe keys are ever engine-produced. */
function identifierKeys(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
}

function compileLiveBody(code: string, keys: string[]): LiveBody {
  const compiled: unknown = vm.runInThisContext(
    `(async function (${keys.join(', ')}) {\n${code}\n})`,
    { filename: 'connector-live-body.js' },
  );
  if (typeof compiled !== 'function') {
    throw new Error('a live connector body did not compile to a function');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an async function expression evaluates to exactly this shape
  return compiled as LiveBody;
}

/** Race the body against its wall clock: an awaited vendor call the host's
 * own timeouts did not bound must still end the INVOCATION — the caller is
 * released; the body runs on until its pending await settles (see the
 * module header). */
function withDeadline<T>(work: Promise<T>, limits: RunnerLimits): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `live connector body exceeded its ${limits.timeoutMs} ms time limit`,
        ),
      );
    }, limits.timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Build the runner. Expressions, sync bodies and syntax checks are the
 * data-only backend's — only the `{ async: true }` live shape runs here, with
 * the scope handed over BY REFERENCE so the host's functions arrive intact.
 */
export function inProcessLiveRunner(): CodeRunner {
  const dataOnly = nodeVmRunner();
  return {
    evalExpr: (expr, scope, limits) => dataOnly.evalExpr(expr, scope, limits),
    checkExpr: (expr) => dataOnly.checkExpr(expr),
    checkBody: (code, opts) => dataOnly.checkBody(code, opts),
    async runBody(code, scope, limits, opts) {
      if (opts?.async !== true) {
        return dataOnly.runBody(code, scope, limits, opts);
      }
      const keys = identifierKeys(scope);
      const body = compileLiveBody(code, keys);
      return withDeadline(body(...keys.map((key) => scope[key])), limits);
    },
    kind() {
      return IN_PROCESS_LIVE_RUNNER_KIND;
    },
  };
}
