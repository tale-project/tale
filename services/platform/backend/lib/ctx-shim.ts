import { functionRefName } from '../../lib/shared/handlers/function-refs.ts';

/**
 * A minimal ActionCtx stand-in for REUSING 0.4 `'use node'` functions whose
 * only Convex dependency is `ctx.runQuery`/`ctx.runMutation` against a small,
 * known set of internal functions. The shim dispatches by the function
 * reference's NAME (`path/module:export`) to SQL-backed handlers the caller
 * registers — the same code path then runs against Postgres.
 *
 * Fail-loud by design: any call to an un-shimmed function (or to any other
 * ctx facility — storage, scheduler, auth) throws with the exact name, so a
 * 0.4 module growing a new ctx dependency surfaces in the integration run
 * instead of silently misbehaving.
 */
export interface ShimHandlers {
  [functionName: string]: (args: unknown) => Promise<unknown>;
}

/**
 * Name a function reference: `path/module:export` for a handler, the raw
 * `_reference/childComponent/…` path for a component. The FORMAT is ours
 * (`convex/lib/function_refs.ts`) — this is the one place both ends of it
 * meet, so the handler tables below and the references the reused bodies
 * build cannot drift apart.
 */
export function shimFunctionName(ref: unknown): string {
  return functionRefName(ref);
}

function dispatcher(kind: string, handlers: ShimHandlers) {
  return async (ref: unknown, args: unknown): Promise<unknown> => {
    const name = shimFunctionName(ref);
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`[ctx-shim] un-shimmed ${kind} call: ${name}`);
    }
    return handler(args);
  };
}

function refuse(facility: string): () => never {
  return () => {
    throw new Error(`[ctx-shim] ctx.${facility} is not available in 0.5`);
  };
}

/** How a shim host runs a scheduled function: by NAME, after a delay. The
 * 0.5 hosts map these onto pg-boss jobs. */
export type ShimScheduler = (
  functionName: string,
  delayMs: number,
  args: unknown,
) => Promise<void>;

/**
 * Build the shim. The return type is deliberately `never`-ish loose — pass
 * it where an `ActionCtx`/`MutationCtx` is expected via the caller's own
 * assertion, keeping the unsafe cast at the call site where the reused
 * function is named.
 */
export function createCtxShim(
  handlers: ShimHandlers,
  options: { scheduler?: ShimScheduler } = {},
): {
  runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
  runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
  runAction: (ref: unknown, args: unknown) => Promise<unknown>;
  storage: { getUrl: () => never; get: () => never };
  scheduler: {
    runAfter: (delayMs: number, ref: unknown, args: unknown) => Promise<void>;
    runAt: () => never;
  };
  auth: { getUserIdentity: () => never };
} {
  const scheduler = options.scheduler;
  return {
    runQuery: dispatcher('query', handlers),
    runMutation: dispatcher('mutation', handlers),
    runAction: dispatcher('action', handlers),
    storage: { getUrl: refuse('storage.getUrl'), get: refuse('storage.get') },
    scheduler: {
      runAfter: async (delayMs, ref, args) => {
        if (scheduler === undefined) {
          throw new Error(
            '[ctx-shim] ctx.scheduler.runAfter is not available in 0.5 (no scheduler seam registered)',
          );
        }
        await scheduler(shimFunctionName(ref), delayMs, args);
      },
      runAt: refuse('scheduler.runAt'),
    },
    auth: { getUserIdentity: refuse('auth.getUserIdentity') },
  };
}
