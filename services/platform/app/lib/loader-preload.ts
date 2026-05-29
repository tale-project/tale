import { convexQuery } from '@convex-dev/react-query';
import type { FunctionArgs, FunctionReference } from 'convex/server';

import type { RouterContext } from '@/app/router';

type QueryArgs<Func extends FunctionReference<'query'>> =
  keyof FunctionArgs<Func> extends never
    ? [args?: FunctionArgs<Func>]
    : [args: FunctionArgs<Func>];

/**
 * Await a small, render-gating Convex query in a route loader. Resolves on the
 * first WebSocket result, warms the React Query cache (so the component reads it
 * warm — no client loading flash), and leaves the live subscription in place.
 *
 * Use ONLY for bounded data that decides what renders (access/member context,
 * the entity that gates content vs. an empty/denied state). Never await a list
 * or unbounded query — blocking the transition is worse than the skeleton.
 */
export function ensureConvexQuery<Func extends FunctionReference<'query'>>(
  context: RouterContext,
  func: Func,
  ...[args]: QueryArgs<Func>
) {
  return context.queryClient.ensureQueryData(convexQuery(func, args ?? {}));
}
