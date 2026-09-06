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

/** A fresh context per evaluation: nothing survives from one body to the
 * next, and authored code finds no host globals. */
function newContext(request: EvalRequest): vm.Context {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  // Defined via the context object so the scope itself is data the script
  // reads, not a host binding.
  vm.runInContext(`__scope = ${request.scopeJson}`, context, {
    timeout: request.timeoutMs,
  });
  return context;
}

function runSync(request: EvalRequest): string | null {
  const out: unknown = new vm.Script(request.source).runInContext(
    newContext(request),
    { timeout: request.timeoutMs },
  );
  return typeof out === 'string' ? out : null;
}

/** The `timeout` option only bounds synchronous execution; a body parked in
 * `await` is what the parent's deadline kill is for. */
async function runAsync(request: EvalRequest): Promise<string | null> {
  const pending: unknown = new vm.Script(request.source).runInContext(
    newContext(request),
    { timeout: request.timeoutMs },
  );
  const out: unknown = await pending;
  return typeof out === 'string' ? out : null;
}

process.on('message', (raw: unknown) => {
  if (!isEvalRequest(raw)) return;
  // The ack starts the parent's deadline clock: queued behind a busy body,
  // a request is not yet running and must not be charged for the wait.
  send({ id: raw.id, started: true });
  void (async () => {
    try {
      const valueJson = raw.async ? await runAsync(raw) : runSync(raw);
      send({ id: raw.id, ok: true, valueJson });
    } catch (error) {
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
