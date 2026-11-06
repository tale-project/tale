import type { ElkLike, FlowElk, FlowElkNode } from './layout-flow-graph';

/**
 * The one ELK every canvas in a tab shares.
 *
 * It runs in a worker — the same-origin file elkjs ships, so a layout never
 * blocks typing or scrolling and the CSP needs no `blob:` or `eval` — and
 * falls back to elkjs's bundled build on the main thread when the worker
 * cannot start (a policy refusing it, a browser without workers): the
 * picture is the same, only the thread differs, and a warning says so once.
 * Both builds load on first use, never with the page.
 *
 * Each canvas holds the worker while it is mounted ({@link retainFlowElk});
 * a minute after the last one goes, the worker ends.
 */

const IDLE_MS = 60_000;

interface Backend {
  readonly engine: 'worker' | 'main';
  readonly elk: ElkLike;
  terminate(): void;
}

let backend: Promise<Backend> | null = null;
let holders = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function mainThread(): Promise<Backend> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  return {
    engine: 'main',
    elk,
    terminate: () => undefined,
  };
}

/** The worker build, or a rejection when it fails before its first answer. */
async function worker(): Promise<Backend> {
  const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
    import('elkjs/lib/elk-api'),
    import('elkjs/lib/elk-worker.min.js?url'),
  ]);
  let failure: ((error: unknown) => void) | undefined;
  const failed = new Promise<never>((_resolve, reject) => {
    failure = reject;
  });
  // Read by every layout in flight; a failure while none is must not
  // surface as an unhandled rejection.
  failed.catch(() => undefined);
  // A worker whose script cannot load reports it as an `error` event, which
  // elkjs's own wrapper ignores: every layout would wait forever.
  const elk = new ELK({
    workerUrl,
    workerFactory: (url) => {
      const created = new Worker(url ?? workerUrl);
      created.addEventListener('error', (event) => {
        failure?.(event.error ?? new Error(event.message || 'worker error'));
      });
      return created;
    },
  });
  // The worker answers this before anything else once it has loaded.
  await Promise.race([elk.knownLayoutAlgorithms(), failed]);
  return {
    engine: 'worker',
    elk: {
      layout: (graph: FlowElkNode) => Promise.race([elk.layout(graph), failed]),
    },
    terminate: () => elk.terminateWorker(),
  };
}

async function createBackend(): Promise<Backend> {
  if (typeof Worker === 'undefined') return mainThread();
  try {
    return await worker();
  } catch (error) {
    console.warn(
      'Flow layout worker unavailable; laying out on the main thread',
      error,
    );
    return mainThread();
  }
}

function current(): Promise<Backend> {
  if (backend === null) {
    backend = createBackend();
    // A build that could not load at all (offline) is tried again next time.
    backend.catch(() => {
      backend = null;
    });
  }
  return backend;
}

/** The shared engine: worker first, the main thread when it cannot run. */
export function getFlowElk(): Promise<FlowElk> {
  return Promise.resolve({
    async layout(graph: FlowElkNode) {
      const chosen = await current();
      try {
        return { graph: await chosen.elk.layout(graph), engine: chosen.engine };
      } catch (error) {
        if (chosen.engine !== 'worker') throw error;
        // The worker died after starting: lay out on the main thread from
        // now on.
        console.warn(
          'Flow layout worker unavailable; laying out on the main thread',
          error,
        );
        chosen.terminate();
        backend = mainThread();
        const main = await backend;
        return { graph: await main.elk.layout(graph), engine: main.engine };
      }
    },
  });
}

/** Keeps the worker alive while a canvas is mounted; call the returned
 *  function when it unmounts. */
export function retainFlowElk(): () => void {
  holders += 1;
  clearTimeout(idleTimer);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders > 0) return;
    idleTimer = setTimeout(() => {
      const ending = backend;
      backend = null;
      void ending?.then(
        (instance) => instance.terminate(),
        () => undefined,
      );
    }, IDLE_MS);
  };
}

/** Forgets the shared engine; tests that stub `Worker` start from scratch. */
export function resetFlowElkForTests(): void {
  clearTimeout(idleTimer);
  const ending = backend;
  backend = null;
  holders = 0;
  void ending?.then(
    (instance) => instance.terminate(),
    () => undefined,
  );
}
