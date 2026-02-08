/**
 * Workpool shard routing
 *
 * Distributes workflow executions across multiple @convex-dev/workflow
 * component instances so that concurrent startWorkflow mutations touch
 * different runStatus singletons, eliminating OCC contention.
 */

export const NUM_SHARDS = 4;

export function getShardIndex(wfDefinitionId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < wfDefinitionId.length; i++) {
    hash ^= wfDefinitionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % NUM_SHARDS;
}
