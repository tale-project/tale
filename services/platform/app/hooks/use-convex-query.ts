import { convexQuery } from '@convex-dev/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

type EmptyObject = Record<string, never>;

interface ConvexQueryOptions {
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
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
  // oxlint-disable-next-line typescript/no-unnecessary-type-arguments -- FunctionReturnType<Func> is not the default (unknown)
): UseQueryResult<FunctionReturnType<Func>> {
  // convexQuery returns a conditional type that useQuery can't resolve in generic context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryOptions: any = { ...convexQuery(func, args ?? {}), ...options };
  return useQuery(queryOptions);
}

export type { ConvexQueryOptions };
