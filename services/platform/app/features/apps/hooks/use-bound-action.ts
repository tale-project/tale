'use client';

/**
 * Generic, capability-gated write. Dispatches ANY public mutation/action the app
 * declared in `capabilities.functions`, by reference path — the open successor
 * to the closed `use-action` dispatch registry. Both a mutation and an action
 * reference are instantiated (rules-of-hooks); `dispatch` invokes the one the
 * binding's `mode` selects, after checking the allowlist and resolving arg
 * templates. A disallowed/invalid path throws rather than calling anything.
 */
import { makeFunctionReference } from 'convex/server';
import { useCallback } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import {
  type FunctionMode,
  isFunctionAllowed,
  isValidFunctionPath,
  resolveBindingArgs,
} from '@/lib/shared/platform/function_bindings';

import { useAppRuntime } from '../runtime/app-runtime';

export interface BoundAction {
  dispatch: (
    args: unknown,
    selected?: Record<string, unknown>,
  ) => Promise<unknown>;
  isPending: boolean;
}

export function useBoundAction(path: string, mode: FunctionMode): BoundAction {
  const { organizationId, appSlug, allowlist } = useAppRuntime();
  const allowed =
    isValidFunctionPath(path) && isFunctionAllowed(path, allowlist, mode);

  const mutation = useConvexMutation(makeFunctionReference<'mutation'>(path));
  const action = useConvexAction(makeFunctionReference<'action'>(path));

  const dispatch = useCallback(
    async (args: unknown, selected?: Record<string, unknown>) => {
      if (!allowed) {
        throw new Error(`Function "${path}" is not in this app's allowlist`);
      }
      const resolved = resolveBindingArgs(args ?? {}, {
        organizationId,
        selected,
      });
      // Phase-1 audit marker (server-side gate + persisted audit is Phase 3).
      console.info('[app-binding]', { appSlug, organizationId, path, mode });
      return mode === 'action'
        ? action.mutateAsync(resolved)
        : mutation.mutateAsync(resolved);
    },
    [allowed, path, mode, organizationId, appSlug, mutation, action],
  );

  return { dispatch, isPending: mutation.isPending || action.isPending };
}
