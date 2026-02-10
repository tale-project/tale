/**
 * Workpool shard routing
 *
 * Distributes workflow executions across multiple @convex-dev/workflow
 * component instances so that concurrent startWorkflow mutations touch
 * different runStatus/pendingStart/pendingCompletion tables,
 * eliminating OCC contention.
 *
 * Shard is derived from the unique executionId (FNV-1a hash) so that
 * concurrent starts of the SAME workflow definition spread evenly
 * across all shards.
 */

export const NUM_SHARDS = 4;

export function getShardIndex(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % NUM_SHARDS;
}

export function safeShardIndex(index: number | undefined): number {
  if (typeof index === 'number' && index >= 0 && index < NUM_SHARDS) {
    return index;
  }
  return 0;
}
