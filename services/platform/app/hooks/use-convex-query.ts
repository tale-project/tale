import type { FunctionArgs, FunctionReference } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

type EmptyObject = Record<string, never>;

interface ConvexQueryOptions {
  staleTime?: number;
  gcTime?: number;
}

type QueryArgs<Func extends FunctionReference<'query'>> =
  keyof FunctionArgs<Func> extends never
    ? [args?: EmptyObject | 'skip', options?: ConvexQueryOptions]
    : EmptyObject extends FunctionArgs<Func>
      ? [args?: FunctionArgs<Func> | 'skip', options?: ConvexQueryOptions]
      : [args: FunctionArgs<Func> | 'skip', options?: ConvexQueryOptions];

export function useConvexQuery<Func extends FunctionReference<'query'>>(
  func: Func,
  ...[args, options]: QueryArgs<Func>
) {
  return useQuery({
    ...convexQuery(func, args ?? {}),
    ...options,
  });
}

export type { ConvexQueryOptions };
