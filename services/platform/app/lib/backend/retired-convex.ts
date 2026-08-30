import { getFunctionName, type FunctionReference } from 'convex/server';

/**
 * What is left of the Convex client after the 0.5 cutover: nothing that
 * talks.
 *
 * Every shipped read and write goes through the adapter registry
 * (`convex-adapters.ts`) to the pg backend. The generated `api` object stays
 * as the seam's NAMING and typing vocabulary — `api.tasks.queries.listTasks`
 * is how a call site says which row it wants — but there is no server behind
 * it any more, and no WebSocket to connect to.
 *
 * So a reference with no adapter row cannot be served at all, and that must
 * FAIL LOUDLY rather than hang on a socket that will never open: this error
 * names the exact function, which is also the registry key someone has to
 * add.
 */
export class ConvexRetiredError extends Error {
  readonly functionName: string;

  constructor(functionName: string) {
    super(
      `"${functionName}" has no 0.5 backend row. The Convex runtime is ` +
        'retired: add an adapter row in app/lib/backend (READ_ADAPTERS, ' +
        'WRITE_ADAPTERS, ACTION_QUERY_ADAPTERS or PAGINATED_ADAPTERS) ' +
        'pointing at the route that serves it.',
    );
    this.name = 'ConvexRetiredError';
    this.functionName = functionName;
  }
}

export function retiredConvexCall(
  func: FunctionReference<'query' | 'mutation' | 'action'>,
): never {
  throw new ConvexRetiredError(getFunctionName(func));
}

/** The imperative escape hatch's backing "client" — every method refuses,
 * naming the function so the gap is obvious in one glance at the console. */
export const retiredConvexClient = {
  query: retiredConvexCall,
  mutation: retiredConvexCall,
  action: retiredConvexCall,
};
