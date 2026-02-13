import type { FunctionArgs, FunctionReference } from 'convex/server';

import { useMutation } from '@tanstack/react-query';

import { useConvexClient } from './use-convex-client';

export function useConvexActionMutation<
  Func extends FunctionReference<'action'>,
>(func: Func) {
  const convexClient = useConvexClient();

  return useMutation({
    mutationFn: (args: FunctionArgs<Func>) => convexClient.action(func, args),
  });
}
