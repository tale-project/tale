/**
 * Generic factory for creating type-safe function references.
 *
 * This approach avoids TS2589 errors by:
 * 1. Using top-level import for the generated API module
 * 2. Accessing properties dynamically at runtime
 * 3. Providing compile-time type safety through explicit type parameters
 */

import type { FunctionReference, FunctionType, FunctionVisibility } from 'convex/server';

import { api, internal } from '../../_generated/api';

type ApiPath = string[];

// Pre-cast to avoid TS2589 in the function body
// @ts-ignore - Convex generated API types are too deep for TypeScript
const apiRecord: Record<string, unknown> = api;
// @ts-ignore - Convex generated API types are too deep for TypeScript
const internalRecord: Record<string, unknown> = internal;

/**
 * Creates a type-safe function reference getter.
 *
 * @param apiType - 'api' for public functions, 'internal' for internal functions
 * @param path - Array of path segments to the function (e.g., ['streaming', 'internal_mutations', 'startStream'])
 * @returns A function reference of the specified type
 *
 * @example
 * ```ts
 * type StartStreamRef = FunctionReference<'mutation', 'internal', { streamId: string }, void>;
 * const getStartStreamRef = () => createRef<StartStreamRef>('internal', ['streaming', 'internal_mutations', 'startStream']);
 * ```
 */
export function createRef<
  Ref extends FunctionReference<FunctionType, FunctionVisibility>,
>(apiType: 'api' | 'internal', path: ApiPath): Ref {
  const apiRoot = apiType === 'api' ? apiRecord : internalRecord;

  let current: unknown = apiRoot;
  for (const segment of path) {
    current = (current as Record<string, unknown>)[segment];
  }

  return current as Ref;
}
