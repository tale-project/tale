import type { FunctionArgs, FunctionReference } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';

type EmptyObject = Record<string, never>;

type QueryArgs<Func extends FunctionReference<'query'>> =
  keyof FunctionArgs<Func> extends never
    ? [args?: EmptyObject | 'skip']
    : EmptyObject extends FunctionArgs<Func>
      ? [args?: FunctionArgs<Func> | 'skip']
      : [args: FunctionArgs<Func> | 'skip'];

export function useConvexQuery<Func extends FunctionReference<'query'>>(
  func: Func,
  ...[args]: QueryArgs<Func>
) {
  return useQuery(convexQuery(func, args ?? {}));
}
