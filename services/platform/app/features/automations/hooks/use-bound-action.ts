'use client';

/**
 * Generic, capability-gated write. Dispatches ANY public mutation/action the automation
 * declared in `capabilities.functions`, by reference path — an open allowlist of
 * function paths, not a fixed set of named action verbs. Both a mutation and an
 * action reference are instantiated (rules-of-hooks); `dispatch` invokes the one
 * the binding's `mode` selects, after checking the allowlist and resolving arg
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

import { useAutomationRuntime } from '../runtime/automation-runtime';
import { useOptionalViewState } from '../runtime/view-state';

/** Per-dispatch resolution context for `$input.`/`$selection.ids`/`$lane`
 *  sentinels — supplied by the dispatching block (a form's field values, a
 *  list's multi-selection, a board's drop lane). `$state.` is merged
 *  automatically from the surrounding view. */
export interface BoundDispatchContext {
  input?: Record<string, unknown>;
  selectionIds?: string[];
  lane?: string;
}

export interface BoundAction {
  dispatch: (
    args: unknown,
    selected?: Record<string, unknown>,
    ctx?: BoundDispatchContext,
  ) => Promise<unknown>;
  isPending: boolean;
}

/**
 * Placeholder for callers that must invoke this hook unconditionally (e.g.
 * Collection's optional `addAction`) when no real path is declared. Must be a
 * syntactically valid reference — `makeFunctionReference('')` yields a value
 * Convex's `getFunctionName` rejects as "not a functionReference", which
 * crashes the Collection error boundary on every desk without an addAction.
 * Dispatch never fires for this path (`allowed` stays false).
 */
const NOOP_FUNCTION_PATH = '_noop/_noop:_noop';

export function useBoundAction(path: string, mode: FunctionMode): BoundAction {
  const { organizationId, projectId, automationSlug, allowlist, config } =
    useAutomationRuntime();
  const viewState = useOptionalViewState();
  const state = viewState?.state;
  const pathOk = isValidFunctionPath(path);
  const allowed = pathOk && isFunctionAllowed(path, allowlist, mode);
  // Hooks must run with a valid FunctionReference even when the caller passed
  // '' / an optional binding — otherwise Convex throws during render.
  const hookPath = pathOk ? path : NOOP_FUNCTION_PATH;

  const mutation = useConvexMutation(
    makeFunctionReference<'mutation'>(hookPath),
  );
  const action = useConvexAction(makeFunctionReference<'action'>(hookPath));

  const dispatch = useCallback(
    async (
      args: unknown,
      selected?: Record<string, unknown>,
      ctx?: BoundDispatchContext,
    ) => {
      if (!allowed) {
        throw new Error(
          `Function "${path}" is not in this automation's allowlist`,
        );
      }
      const resolved = resolveBindingArgs(args ?? {}, {
        organizationId,
        projectId,
        selected,
        config,
        state,
        input: ctx?.input,
        selectionIds: ctx?.selectionIds,
        lane: ctx?.lane,
      });
      // Phase-1 audit marker (server-side gate + persisted audit is Phase 3).
      console.info('[automation-binding]', {
        automationSlug,
        organizationId,
        path,
        mode,
      });
      return mode === 'action'
        ? action.mutateAsync(resolved)
        : mutation.mutateAsync(resolved);
    },
    [
      allowed,
      path,
      mode,
      organizationId,
      projectId,
      automationSlug,
      config,
      state,
      mutation,
      action,
    ],
  );

  return { dispatch, isPending: mutation.isPending || action.isPending };
}
