/**
 * Load Delegate Agent Configurations
 *
 * Fetches the active published versions of delegate agents from the DB
 * and converts them to DelegateAgentMeta for tool creation.
 */

'use node';

import type { ActionCtx } from '../../_generated/server';
import type { DelegateAgentMeta } from './create_delegation_tool';

import { internal } from '../../_generated/api';

export async function loadDelegateAgents(
  ctx: ActionCtx,
  delegateAgentIds: string[],
  organizationId: string,
): Promise<DelegateAgentMeta[]> {
  if (delegateAgentIds.length === 0) return [];

  const delegates = await ctx.runQuery(
    internal.custom_agents.internal_queries.getActiveDelegateAgents,
    {
      rootVersionIds: delegateAgentIds,
      organizationId,
    },
  );

  return delegates;
}
