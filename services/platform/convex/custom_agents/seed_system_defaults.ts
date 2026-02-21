/**
 * Seed System Default Agents
 *
 * Creates the 6 system default agent records for an organization.
 * Idempotent: skips agents that already exist (by systemAgentSlug).
 * Resolves delegate agent references (slugs → rootVersionIds) in a second pass.
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
    return agent;
  }
  return null;
}

async function insertSystemAgent(
  ctx: MutationCtx,
  organizationId: string,
  template: SystemDefaultAgentTemplate,
) {
  const shouldPublish = template.publishOnSeed === true;

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
    knowledgeEnabled: template.knowledgeEnabled,
    includeOrgKnowledge: template.includeOrgKnowledge,
    filePreprocessingEnabled: template.filePreprocessingEnabled,
    visibleInChat: template.visibleInChat,
    isSystemDefault: true,
    systemAgentSlug: template.systemAgentSlug,
    createdBy: 'system',
    versionNumber: 1,
    status: shouldPublish ? 'active' : 'draft',
    ...(shouldPublish && {
      publishedAt: Date.now(),
      publishedBy: 'system',
    }),
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

    if (existing) {
      if (!existing.rootVersionId) {
        await ctx.db.patch(existing._id, { rootVersionId: existing._id });
      }
      slugToId.set(
        template.systemAgentSlug,
        existing.rootVersionId ?? existing._id,
      );
    } else {
      const agentId = await insertSystemAgent(ctx, organizationId, template);
      slugToId.set(template.systemAgentSlug, agentId);
    }
  }

  // Pass 2: Resolve delegate slugs to rootVersionIds
  for (const template of SYSTEM_DEFAULT_AGENT_TEMPLATES) {
    if (template.delegateSlugs.length === 0) continue;

    const agentId = slugToId.get(template.systemAgentSlug);
    if (!agentId) continue;

    const delegateAgentIds: Id<'customAgents'>[] = [];
    for (const slug of template.delegateSlugs) {
      const delegateId = slugToId.get(slug);
      if (delegateId) {
        delegateAgentIds.push(delegateId);
      }
    }

    if (delegateAgentIds.length > 0) {
      await ctx.db.patch(agentId, { delegateAgentIds });
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
