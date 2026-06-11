/**
 * Shard-aware workflow component lookup.
 *
 * Executions are distributed across four `@convex-dev/workflow` component
 * instances (`workflow`, `workflow_1..3`) by `getShardIndex(executionId)` at
 * start time (see `wf_executions/internal_mutations.ts`). Any read of a
 * component-side resource (journal, runStatus, …) must target the SAME shard
 * the execution was started on, otherwise the lookup silently misses.
 */

import { components } from '../../_generated/api';
import {
  getShardIndex,
  safeShardIndex,
} from '../../workflow_engine/helpers/engine/shard';

/** Shard-ordered component instances; index = shard index. */
export const WORKFLOW_COMPONENTS = [
  components.workflow,
  components.workflow_1,
  components.workflow_2,
  components.workflow_3,
] as const;

interface ShardedExecution {
  _id: string;
  shardIndex?: number;
}

/**
 * Resolve the shard an execution runs on. Prefers the persisted `shardIndex`;
 * falls back to re-deriving it from the execution id — the same hash used at
 * start time, so the fallback is deterministic for rows written before
 * `shardIndex` existed.
 */
export function resolveExecutionShardIndex(
  execution: ShardedExecution,
): number {
  return safeShardIndex(execution.shardIndex ?? getShardIndex(execution._id));
}

export function getWorkflowComponentForExecution(
  execution: ShardedExecution,
): (typeof WORKFLOW_COMPONENTS)[number] {
  return WORKFLOW_COMPONENTS[resolveExecutionShardIndex(execution)];
}
