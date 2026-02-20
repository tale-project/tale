/**
 * Seed System Default Agents
 *
 * Creates the 6 system default agent records for an organization.
 * Idempotent: skips agents that already exist (by systemAgentSlug).
 * Resolves partner agent references (slugs → rootVersionIds) in a second pass.
 */

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { internalMutation } from '../_generated/server';
import {
  SYSTEM_DEFAULT_AGENT_TEMPLATES,
  type SystemDefaultAgentTemplate,
} from './system_defaults';

async function getSystemDefaultBySlug(
  ctx: MutationCtx,
  organizationId: string,
  slug: string,
) {
  const query = ctx.db
    .query('customAgents')
    .withIndex('by_org_system_slug', (q) =>
      q.eq('organizationId', organizationId).eq('systemAgentSlug', slug),
    );
  for await (const agent of query) {
    if (agent.isActive) return agent;
  }
  return null;
}

async function insertSystemAgent(
  ctx: MutationCtx,
  organizationId: string,
  template: SystemDefaultAgentTemplate,
) {
  const agentId = await ctx.db.insert('customAgents', {
    organizationId,
    name: template.name,
    displayName: template.displayName,
    description: template.description,
    systemInstructions: template.systemInstructions,
    toolNames: template.toolNames,
    modelPreset: template.modelPreset,
    maxSteps: template.maxSteps,
    timeoutMs: template.timeoutMs,
    outputReserve: template.outputReserve,
    roleRestriction: template.roleRestriction,
    isSystemDefault: true,
    systemAgentSlug: template.systemAgentSlug,
    createdBy: 'system',
    isActive: true,
    versionNumber: 1,
    status: 'active',
    publishedAt: Date.now(),
    publishedBy: 'system',
  });

  await ctx.db.patch(agentId, { rootVersionId: agentId });

  return agentId;
}

async function seedDefaults(ctx: MutationCtx, organizationId: string) {
  // Pass 1: Insert missing system default agents
  const slugToId = new Map<string, Id<'customAgents'>>();

  for (const template of SYSTEM_DEFAULT_AGENT_TEMPLATES) {
    const existing = await getSystemDefaultBySlug(
      ctx,
      organizationId,
      template.systemAgentSlug,
    );

    if (existing?.rootVersionId) {
      slugToId.set(template.systemAgentSlug, existing.rootVersionId);
    } else {
      const agentId = await insertSystemAgent(ctx, organizationId, template);
      slugToId.set(template.systemAgentSlug, agentId);
    }
  }

  // Pass 2: Resolve partner slugs to rootVersionIds
  for (const template of SYSTEM_DEFAULT_AGENT_TEMPLATES) {
    if (template.partnerSlugs.length === 0) continue;

    const agentId = slugToId.get(template.systemAgentSlug);
    if (!agentId) continue;

    const partnerAgentIds: Id<'customAgents'>[] = [];
    for (const slug of template.partnerSlugs) {
      const partnerId = slugToId.get(slug);
      if (partnerId) {
        partnerAgentIds.push(partnerId);
      }
    }

    if (partnerAgentIds.length > 0) {
      await ctx.db.patch(agentId, { partnerAgentIds });
    }
  }
}

export const seedSystemDefaultAgents = internalMutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    await seedDefaults(ctx, args.organizationId);
  },
});

export const ensureSystemDefaults = internalMutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getSystemDefaultBySlug(
      ctx,
      args.organizationId,
      'chat',
    );
    if (existing) return;

    await seedDefaults(ctx, args.organizationId);
  },
});
