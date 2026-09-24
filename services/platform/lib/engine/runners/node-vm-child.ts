/**
 * The node:vm evaluation loop, run as the CHILD PROCESS `node-vm.ts`
 * supervises. One request in (over the IPC channel), one envelope out.
 *
 * Nothing here is reachable from authored code: the scope enters the vm
 * context as parsed JSON, the context has a null prototype and no code
 * generation, and the result leaves as a JSON string — the same data-only
 * convention the parent documents. What THIS process adds is the fault
 * boundary: it is started with a V8 heap cap and killed by the parent when
 * an evaluation overruns, so a runaway body takes down this process, never
 * the API or worker that spawned it.
 *
 * Plain erasable TypeScript on purpose — node runs it with type stripping
 * and no loader, so it works the same under the production runtime, a
 * vitest worker, and a bare `node` on a developer machine.
 */

import vm from 'node:vm';

/** One evaluation, as the parent ships it. */
interface EvalRequest {
  id: number;
  /** The wrapped source; evaluates to the `{"v": …}` envelope string, or to
   * a promise of it when `async` is set. */
  source: string;
  async: boolean;
  /** The data-only scope, already serialized. */
  scopeJson: string;
  /** vm's synchronous budget; the parent enforces the hard kill above it. */
  timeoutMs: number;
}

function isEvalRequest(v: unknown): v is EvalRequest {
  if (v === null || typeof v !== 'object') return false;
  const r: Record<string, unknown> = { ...v };
  return (
    typeof r.id === 'number' &&
    typeof r.source === 'string' &&
    typeof r.async === 'boolean' &&
    typeof r.scopeJson === 'string' &&
    typeof r.timeoutMs === 'number'
  );
}

function send(message: unknown): void {
  // `process.send` exists only under an IPC channel; without one there is
  // nobody to answer — the parent has gone and this process is on its way
  // out via 'disconnect'.
  if (process.send !== undefined) process.send(message);
}

/**
 * How long loading a scope into its context may take. A scope is
 * engine-produced JSON — never authored code — so this bounds a linear parse
 * whose only other limit is the heap cap. It is deliberately NOT the
 * evaluation's own budget: a scope carries every prior node output, and an
 * expression that reads one field of it must not pay for parsing the rest.
 */
const SCOPE_LOAD_TIMEOUT_MS = 10_000;

/** A fresh context per evaluation: nothing survives from one body to the
 * next, and authored code finds no host globals. */
function newContext(request: EvalRequest): vm.Context {
  const sandbox: Record<string, unknown> = Object.create(null);
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  // The scope crosses as a primitive string and is parsed INSIDE the
  // context, so its objects belong to the context's realm and the scope is
  // data the script reads, not a host binding. JSON.parse is also what the
  // data-only convention means: a `"__proto__"` key stays a key, where
  // compiling the JSON as an object literal would have set a prototype.
  sandbox.__scopeJson = request.scopeJson;
  try {
    vm.runInContext('__scope = JSON.parse(__scopeJson)', context, {
      timeout: SCOPE_LOAD_TIMEOUT_MS,
    });
  } catch (error) {
    const mb = (request.scopeJson.length / 1_048_576).toFixed(1);
    throw new Error(
      `the evaluation scope (${mb} MB of JSON) could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    delete sandbox.__scopeJson;
  }
  return context;
}

function runSync(request: EvalRequest, context: vm.Context): string | null {
  const out: unknown = new vm.Script(request.source).runInContext(context, {
    timeout: request.timeoutMs,
  });
  return typeof out === 'string' ? out : null;
}

/** The `timeout` option only bounds synchronous execution; a body parked in
 * `await` is what the parent's deadline kill is for. */
async function runAsync(
  request: EvalRequest,
  context: vm.Context,
): Promise<string | null> {
  const pending: unknown = new vm.Script(request.source).runInContext(context, {
    timeout: request.timeoutMs,
  });
  const out: unknown = await pending;
  return typeof out === 'string' ? out : null;
}

process.on('message', (raw: unknown) => {
  if (!isEvalRequest(raw)) return;
  void (async () => {
    let context: vm.Context;
    try {
      context = newContext(raw);
    } catch (error) {
      send({
        id: raw.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // The ack starts the parent's deadline clock, so it leaves once the scope
    // is in place and only the authored code remains: queued behind a busy
    // body, or behind its own scope's parse, a request is not yet running
    // and must not be charged for the wait.
    send({ id: raw.id, started: true });
    try {
      const valueJson = raw.async
        ? await runAsync(raw, context)
        : runSync(raw, context);
      // `finished` stops that clock before the answer ships: an answer can be
      // large, and a deadline must never fire on bytes still in transit.
      send({ id: raw.id, finished: true });
      send({ id: raw.id, ok: true, valueJson });
    } catch (error) {
      send({ id: raw.id, finished: true });
      send({
        id: raw.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

// The parent is gone (exited or replaced this process): nothing left to do.
process.on('disconnect', () => {
  process.exit(0);
});

send({ ready: true });
