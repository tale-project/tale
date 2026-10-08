/** Exact b493 declarations; tests guard every body against the retained raw source.
 * Adapter only projects PG rows and omits realtime hints; it adds no fencing.
 * Historical fixture only; .dockerignore excludes services/platform/tests. */
import type {
  AgentCursor,
  NodeCursor,
} from '../../../backend/core/automations/checkpoints.ts';

export interface AgentCursorState {
  status: string;
  cursor?: Pick<NodeCursor, 'node'> & { agent?: AgentCursor };
}

const LIVE_RUN_STATUSES = new Set(['waiting', 'running', 'queued']);

export function workflowTurnStartRefusal(
  state: AgentCursorState | null,
  keys: { nodeId: string; execId: string },
): { reason: string; runEnded: boolean } | null {
  if (state === null) return { reason: 'the run is gone', runEnded: true };
  if (!LIVE_RUN_STATUSES.has(state.status)) {
    return { reason: `the run is ${state.status}`, runEnded: true };
  }
  const cursor = state.cursor;
  if (cursor === undefined) return null;
  if (cursor.node !== keys.nodeId) {
    return {
      reason: `the run moved on to node ${cursor.node}`,
      runEnded: false,
    };
  }
  const agent = cursor.agent;
  if (agent === undefined) return null;
  if (agent.execId === keys.execId) {
    return agent.result !== undefined
      ? { reason: 'this turn already settled', runEnded: false }
      : null;
  }
  return agent.result === undefined
    ? { reason: `exec ${agent.execId} superseded it`, runEnded: false }
    : null;
}
