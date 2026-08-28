import { getFunctionName } from 'convex/server';

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

function dispatcher(kind: string, handlers: ShimHandlers) {
  return async (ref: unknown, args: unknown): Promise<unknown> => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- getFunctionName accepts any function reference; the shim's whole job is bridging the untyped seam
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`[convex-shim] un-shimmed ${kind} call: ${name}`);
    }
    return handler(args);
  };
}

function refuse(facility: string): () => never {
  return () => {
    throw new Error(`[convex-shim] ctx.${facility} is not available in 0.5`);
  };
}

/**
 * Build the shim. The return type is deliberately `never`-ish loose — pass
 * it where an `ActionCtx`/`MutationCtx` is expected via the caller's own
 * assertion, keeping the unsafe cast at the call site where the reused
 * function is named.
 */
export function createCtxShim(handlers: ShimHandlers): {
  runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
  runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
  runAction: (ref: unknown, args: unknown) => Promise<unknown>;
  storage: { getUrl: () => never; get: () => never };
  scheduler: { runAfter: () => never; runAt: () => never };
  auth: { getUserIdentity: () => never };
} {
  return {
    runQuery: dispatcher('query', handlers),
    runMutation: dispatcher('mutation', handlers),
    runAction: dispatcher('action', handlers),
    storage: { getUrl: refuse('storage.getUrl'), get: refuse('storage.get') },
    scheduler: {
      runAfter: refuse('scheduler.runAfter'),
      runAt: refuse('scheduler.runAt'),
    },
    auth: { getUserIdentity: refuse('auth.getUserIdentity') },
  };
}
