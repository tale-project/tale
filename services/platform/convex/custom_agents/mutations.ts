/**
 * CRUD mutations for custom agents with single-table immutable versioning.
 *
 * Each version (draft, active, archived) is a separate document in `customAgents`.
 * All versions of the same agent share a `rootVersionId` (the v1 record's _id).
 * The draft record is freely editable; published (active) versions are immutable.
 *
 * The `customAgentId` arg in each mutation is the stable agent identifier, which
 * is the `rootVersionId` (i.e. the `_id` of the first version ever created).
 */

import { v } from 'convex/values';

import type { Id, Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { mutation } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import { modelPresetValidator } from './schema';

const toolNamesValidator = v.array(v.string());

const agentFieldsValidator = {
  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  systemInstructions: v.string(),
  toolNames: toolNamesValidator,
  integrationBindings: v.optional(v.array(v.string())),
  modelPreset: modelPresetValidator,
  knowledgeEnabled: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  knowledgeTopK: v.optional(v.number()),
  toneOfVoiceId: v.optional(v.id('toneOfVoice')),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
};

function validateToolNames(toolNames: string[]) {
  const validNames = new Set<string>(TOOL_NAMES);
  const invalid = toolNames.filter((name) => !validNames.has(name));
  if (invalid.length > 0) {
    throw new Error(`Invalid tool names: ${invalid.join(', ')}`);
  }
}

function syncRagSearchTool(
  cleanUpdate: Record<string, unknown>,
  knowledgeEnabled: boolean | undefined,
  draft: Doc<'customAgents'>,
) {
  const toolNames = Array.isArray(cleanUpdate.toolNames)
    ? cleanUpdate.toolNames
    : draft.toolNames;
  const hasRag = toolNames.includes('rag_search');
  const isEnabled = knowledgeEnabled ?? draft.knowledgeEnabled;

  if (knowledgeEnabled !== undefined) {
    if (knowledgeEnabled && !hasRag) {
      cleanUpdate.toolNames = [...toolNames, 'rag_search'];
    } else if (!knowledgeEnabled && hasRag) {
      cleanUpdate.toolNames = toolNames.filter((t) => t !== 'rag_search');
    }
  } else if (isEnabled && !hasRag && cleanUpdate.toolNames !== undefined) {
    // Guard: toolNames updated without knowledgeEnabled change — re-add rag_search
    cleanUpdate.toolNames = [...toolNames, 'rag_search'];
  }
}

async function getVersionByRootAndStatus(
  ctx: MutationCtx,
  rootVersionId: Id<'customAgents'>,
  status: 'draft' | 'active' | 'archived',
) {
  const query = ctx.db
    .query('customAgents')
    .withIndex('by_root_status', (q) =>
      q.eq('rootVersionId', rootVersionId).eq('status', status),
    );
  for await (const version of query) {
    return version;
  }
  return null;
}

async function getDraftByRoot(
  ctx: MutationCtx,
  rootVersionId: Id<'customAgents'>,
) {
  const draft = await getVersionByRootAndStatus(ctx, rootVersionId, 'draft');
  if (!draft || !draft.isActive) throw new Error('Agent not found');
  return draft;
}

async function getMaxVersionNumber(
  ctx: MutationCtx,
  rootVersionId: Id<'customAgents'>,
) {
  let max = 0;
  const versions = ctx.db
    .query('customAgents')
    .withIndex('by_root', (q) => q.eq('rootVersionId', rootVersionId));
  for await (const v of versions) {
    if (v.versionNumber > max) max = v.versionNumber;
  }
  return max;
}

function copyVersionFields(source: Doc<'customAgents'>) {
  return {
    organizationId: source.organizationId,
    name: source.name,
    displayName: source.displayName,
    description: source.description,
    avatarUrl: source.avatarUrl,
    systemInstructions: source.systemInstructions,
    toolNames: source.toolNames,
    integrationBindings: source.integrationBindings,
    modelPreset: source.modelPreset,
    knowledgeEnabled: source.knowledgeEnabled,
    includeOrgKnowledge: source.includeOrgKnowledge,
    knowledgeTopK: source.knowledgeTopK,
    toneOfVoiceId: source.toneOfVoiceId,
    teamId: source.teamId,
    sharedWithTeamIds: source.sharedWithTeamIds,
    createdBy: source.createdBy,
  };
}

export const createCustomAgent = mutation({
  args: {
    organizationId: v.string(),
    ...agentFieldsValidator,
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!/^[a-z0-9][a-z0-9-]*$/.test(args.name)) {
      throw new Error(
        'Agent name must start with a letter or number and contain only lowercase letters, numbers, and hyphens',
      );
    }

    validateToolNames(args.toolNames);

    const { organizationId, toolNames, ...agentFields } = args;

    const finalToolNames =
      args.knowledgeEnabled && !toolNames.includes('rag_search')
        ? [...toolNames, 'rag_search']
        : toolNames;

    const agentId = await ctx.db.insert('customAgents', {
      organizationId,
      ...agentFields,
      toolNames: finalToolNames,
      createdBy: String(authUser._id),
      isActive: true,
      versionNumber: 1,
      status: 'draft',
    });

    await ctx.db.patch(agentId, { rootVersionId: agentId });

    return agentId;
  },
});

export const updateCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
    description: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    systemInstructions: v.optional(v.string()),
    toolNames: v.optional(toolNamesValidator),
    integrationBindings: v.optional(v.array(v.string())),
    modelPreset: v.optional(modelPresetValidator),
    knowledgeEnabled: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeTopK: v.optional(v.number()),
    toneOfVoiceId: v.optional(v.id('toneOfVoice')),
    teamId: v.optional(v.string()),
    sharedWithTeamIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    if (args.toolNames) {
      validateToolNames(args.toolNames);
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const { customAgentId: _, teamId, ...otherFields } = args;

    const cleanUpdate: Record<string, unknown> = Object.fromEntries(
      Object.entries(otherFields).filter(([_k, value]) => value !== undefined),
    );

    if (teamId !== undefined) {
      cleanUpdate.teamId = teamId || undefined;
    }

    // Synchronize rag_search tool with knowledgeEnabled
    syncRagSearchTool(cleanUpdate, args.knowledgeEnabled, draft);

    await ctx.db.patch(draft._id, cleanUpdate);
  },
});

export const updateCustomAgentMetadata = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
    description: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    teamId: v.optional(v.string()),
    sharedWithTeamIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const { customAgentId: _id, teamId, ...otherFields } = args;

    const cleanUpdate: Record<string, unknown> = Object.fromEntries(
      Object.entries(otherFields).filter(([_k, value]) => value !== undefined),
    );

    if (teamId !== undefined) {
      cleanUpdate.teamId = teamId || undefined;
    }

    await ctx.db.patch(draft._id, cleanUpdate);
  },
});

export const deleteCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const activeVersion = await getVersionByRootAndStatus(
      ctx,
      args.customAgentId,
      'active',
    );
    if (activeVersion) {
      await ctx.db.patch(activeVersion._id, { status: 'archived' });
    }

    await ctx.db.patch(draft._id, { isActive: false, status: 'archived' });
  },
});

export const duplicateCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const source = await getDraftByRoot(ctx, args.customAgentId);

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(source, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const newName = args.name ?? `${source.name}-copy`;
    const newDisplayName = args.displayName ?? `${source.displayName} (Copy)`;

    const newAgentId = await ctx.db.insert('customAgents', {
      ...copyVersionFields(source),
      name: newName,
      displayName: newDisplayName,
      createdBy: String(authUser._id),
      isActive: true,
      versionNumber: 1,
      status: 'draft',
    });

    await ctx.db.patch(newAgentId, { rootVersionId: newAgentId });

    return newAgentId;
  },
});

export const publishCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const activeVersion = await getVersionByRootAndStatus(
      ctx,
      args.customAgentId,
      'active',
    );
    if (activeVersion) {
      await ctx.db.patch(activeVersion._id, { status: 'archived' });
    }

    await ctx.db.patch(draft._id, {
      status: 'active',
      publishedAt: Date.now(),
      publishedBy: String(authUser._id),
    });
  },
});

export const unpublishCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const activeVersion = await getVersionByRootAndStatus(
      ctx,
      args.customAgentId,
      'active',
    );
    if (!activeVersion) {
      throw new Error('Agent is not published');
    }

    await ctx.db.patch(activeVersion._id, { status: 'archived' });
  },
});

export const activateCustomAgentVersion = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    targetVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    let targetVersion: Doc<'customAgents'> | null = null;
    const versions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId));
    for await (const v of versions) {
      if (v.versionNumber === args.targetVersion) {
        targetVersion = v;
        break;
      }
    }

    if (!targetVersion) {
      throw new Error(`Version ${args.targetVersion} not found`);
    }

    if (targetVersion.status === 'active') {
      throw new Error('Version is already active');
    }

    if (targetVersion.status === 'draft') {
      throw new Error('Cannot activate a draft version directly');
    }

    const activeVersion = await getVersionByRootAndStatus(
      ctx,
      args.customAgentId,
      'active',
    );
    if (activeVersion) {
      await ctx.db.patch(activeVersion._id, { status: 'archived' });
    }

    await ctx.db.patch(targetVersion._id, { status: 'active' });
  },
});

export const createDraftFromVersion = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    sourceVersionNumber: v.number(),
  },
  returns: v.object({
    draftId: v.id('customAgents'),
    isExisting: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const existingDraft = await getVersionByRootAndStatus(
      ctx,
      args.customAgentId,
      'draft',
    );
    if (existingDraft) {
      return { draftId: existingDraft._id, isExisting: true };
    }

    let source: Doc<'customAgents'> | null = null;
    const versions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId));
    for await (const v of versions) {
      if (v.versionNumber === args.sourceVersionNumber) {
        source = v;
        break;
      }
    }

    if (!source) {
      throw new Error(`Version ${args.sourceVersionNumber} not found`);
    }

    const maxVersion = await getMaxVersionNumber(ctx, args.customAgentId);
    const newVersionNumber = maxVersion + 1;

    const draftId = await ctx.db.insert('customAgents', {
      ...copyVersionFields(source),
      isActive: true,
      versionNumber: newVersionNumber,
      status: 'draft',
      rootVersionId: args.customAgentId,
      parentVersionId: source._id,
    });

    return { draftId, isExisting: false };
  },
});
