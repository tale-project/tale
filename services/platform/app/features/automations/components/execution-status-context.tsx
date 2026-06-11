'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useUrlState } from '@/app/hooks/use-url-state';
import type { ExecutionStepStatuses } from '@/convex/workflows/executions/get_execution_step_statuses';

import { useExecutionStepStatuses } from '../hooks/queries';

/**
 * Shared "viewed execution" state for the automation detail page.
 *
 * The viewed execution id lives in the `execution` URL param (written by the
 * test panel after starting a run, survives reloads and deep links). This
 * provider subscribes once to the derived per-node status query and fans the
 * result out to the canvas nodes via context — NOT via ReactFlow `node.data`,
 * which would retrigger StoreUpdater on every journal write (see
 * `AutomationCallbacksProvider` for the render-loop rationale).
 *
 * Kept separate from `AUTOMATION_PANEL_URL_DEFINITIONS` so closing a side
 * panel (`clearAll` on the panel definitions) does not drop the viewed run.
 */
export const AUTOMATION_EXECUTION_URL_DEFINITIONS = {
  execution: { default: null },
} as const;

interface ExecutionStatusContextValue {
  executionId: string | null;
  statuses: ExecutionStepStatuses | null;
}

const ExecutionStatusContext = createContext<ExecutionStatusContextValue>({
  executionId: null,
  statuses: null,
});

export function ExecutionStatusProvider({ children }: { children: ReactNode }) {
  const { state } = useUrlState({
    definitions: AUTOMATION_EXECUTION_URL_DEFINITIONS,
  });
  const executionId = state.execution;
  const { data } = useExecutionStepStatuses(executionId ?? undefined);

  const value = useMemo(
    () => ({ executionId, statuses: data ?? null }),
    [executionId, data],
  );

  return (
    <ExecutionStatusContext.Provider value={value}>
      {children}
    </ExecutionStatusContext.Provider>
  );
}

/**
 * Per-node execution state for one canvas node, or `null` when no execution
 * is being viewed (or the node has not run). Safe to call without a provider
 * (returns `null`) so node components stay renderable in isolation.
 */
export function useNodeExecutionStatus(stepSlug: string) {
  const { statuses } = useContext(ExecutionStatusContext);
  return statuses?.nodes[stepSlug] ?? null;
}

/** Execution-level view state (id + run summary) for banners and panels. */
export function useViewedExecution() {
  const { executionId, statuses } = useContext(ExecutionStatusContext);
  return { executionId, execution: statuses?.execution ?? null };
}
