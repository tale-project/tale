/**
 * Load Partner Agent Configurations
 *
 * Fetches the active published versions of partner agents from the DB
 * and converts them to PartnerAgentMeta for tool creation.
 */

'use node';

import type { ActionCtx } from '../../_generated/server';
import type { PartnerAgentMeta } from './create_partner_tool';

import { internal } from '../../_generated/api';

export async function loadPartnerAgents(
  ctx: ActionCtx,
  partnerAgentIds: string[],
  organizationId: string,
): Promise<PartnerAgentMeta[]> {
  if (partnerAgentIds.length === 0) return [];

  const partners = await ctx.runQuery(
    internal.custom_agents.internal_queries.getActivePartnerAgents,
    {
      rootVersionIds: partnerAgentIds,
      organizationId,
    },
  );

  return partners;
}
