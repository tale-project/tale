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

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { parseModelList } from '../../lib/shared/utils/model-list';
import { mutation } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import {
  modelPresetValidator,
  retrievalModeValidator,
  roleRestrictionValidator,
} from './schema';

const toolNamesValidator = v.array(v.string());

const agentFieldsValidator = {
  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  systemInstructions: v.string(),
  toolNames: toolNamesValidator,
  integrationBindings: v.optional(v.array(v.string())),
  workflowBindings: v.optional(v.array(v.id('wfDefinitions'))),
  modelPreset: modelPresetValidator,
  modelId: v.optional(v.string()),
  knowledgeMode: v.optional(retrievalModeValidator),
  webSearchMode: v.optional(retrievalModeValidator),
  knowledgeEnabled: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  knowledgeTopK: v.optional(v.number()),
  filePreprocessingEnabled: v.optional(v.boolean()),
  structuredResponsesEnabled: v.optional(v.boolean()),
  teamId: v.optional(v.string()),
  delegateAgentIds: v.optional(v.array(v.id('customAgents'))),
  maxSteps: v.optional(v.number()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  roleRestriction: v.optional(roleRestrictionValidator),
};

function validateModelId(modelId: string | undefined) {
  if (!modelId) return;
  const allModels = [
    ...parseModelList(process.env.OPENAI_FAST_MODEL),
    ...parseModelList(process.env.OPENAI_MODEL),
    ...parseModelList(process.env.OPENAI_CODING_MODEL),
  ];
  if (!allModels.includes(modelId)) {
    throw new Error(
      `Invalid model: ${modelId}. Available models: ${allModels.join(', ')}`,
    );
  }
}

function filterValidToolNames(toolNames: string[]): string[] {
  const validNames = new Set<string>(TOOL_NAMES);
  return toolNames.filter((name) => validNames.has(name));
}

const PROTECTED_SYSTEM_SLUGS = new Set(['chat', 'workflow']);

const MAX_WORKFLOW_BINDINGS = 20;

async function validateWorkflowBindings(
  ctx: MutationCtx,
  workflowBindings: Id<'wfDefinitions'>[] | undefined,
  organizationId: string,
): Promise<Id<'wfDefinitions'>[] | undefined> {
  if (!workflowBindings?.length) return workflowBindings;

  if (workflowBindings.length > MAX_WORKFLOW_BINDINGS) {
    throw new Error(
      `Cannot bind more than ${MAX_WORKFLOW_BINDINGS} workflows to an agent`,
    );
  }

  const valid: Id<'wfDefinitions'>[] = [];
  for (const wfId of workflowBindings) {
    const wf = await ctx.db.get(wfId);
    if (!wf) continue;
    if (wf.organizationId !== organizationId) {
      throw new Error(
        `Workflow "${wf.name}" does not belong to this organization`,
      );
    }
    valid.push(wfId);
  }
  return valid.length ? valid : undefined;
}

type RetrievalMode = 'off' | 'tool' | 'context' | 'both';

function modeNeedsTool(mode: RetrievalMode): boolean {
  return mode === 'tool' || mode === 'both';
}

interface RetrievalModeState {
  toolNames: string[];
  knowledgeEnabled?: boolean;
  knowledgeMode?: RetrievalMode;
  webSearchMode?: RetrievalMode;
}

function syncRetrievalModes(
  cleanUpdate: Record<string, unknown>,
  args: {
    knowledgeMode?: RetrievalMode;
    webSearchMode?: RetrievalMode;
  },
  current: RetrievalModeState,
) {
  let toolNames: string[] = Array.isArray(cleanUpdate.toolNames)
    ? [...cleanUpdate.toolNames]
    : [...current.toolNames];

  const kMode =
    args.knowledgeMode ??
    current.knowledgeMode ??
    (current.knowledgeEnabled ? 'tool' : 'off');
  const wMode =
    args.webSearchMode ??
    current.webSearchMode ??
    (toolNames.includes('web') ? 'tool' : 'off');

  // Sync rag_search tool
  if (modeNeedsTool(kMode) && !toolNames.includes('rag_search')) {
    toolNames.push('rag_search');
  } else if (!modeNeedsTool(kMode)) {
    toolNames = toolNames.filter((t) => t !== 'rag_search');
  }

  // Sync web tool
  if (modeNeedsTool(wMode) && !toolNames.includes('web')) {
    toolNames.push('web');
  } else if (!modeNeedsTool(wMode)) {
    toolNames = toolNames.filter((t) => t !== 'web');
  }

  cleanUpdate.toolNames = toolNames;

  // Keep knowledgeEnabled in sync as derived field
  if (args.knowledgeMode !== undefined) {
    cleanUpdate.knowledgeEnabled = args.knowledgeMode !== 'off';
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
  if (!draft) throw new Error('Agent not found');
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
  for await (const version of versions) {
    if (version.versionNumber > max) max = version.versionNumber;
  }
  return max;
}

const VERSION_META_FIELDS = [
  '_id',
  '_creationTime',
  'versionNumber',
  'status',
  'rootVersionId',
  'parentVersionId',
  'publishedAt',
  'publishedBy',
  'changeLog',
] as const;

function copyVersionFields(source: Doc<'customAgents'>) {
  const copy = { ...source };
  for (const key of VERSION_META_FIELDS) {
    delete copy[key];
  }
  if (copy.partnerAgentIds) {
    copy.delegateAgentIds = copy.delegateAgentIds ?? copy.partnerAgentIds;
    delete copy.partnerAgentIds;
  }
  return copy;
}

export const createCustomAgent = mutation({
  args: {
    organizationId: v.string(),
    ...agentFieldsValidator,
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args): Promise<Id<'customAgents'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.name)) {
      throw new Error(
        'Agent name must start with a letter or number and contain only lowercase letters, numbers, hyphens, and underscores',
      );
    }

    args.toolNames = filterValidToolNames(args.toolNames);
    validateModelId(args.modelId);
    const validatedWorkflowBindings = await validateWorkflowBindings(
      ctx,
      args.workflowBindings,
      args.organizationId,
    );

    if (args.systemInstructions.trim().length === 0) {
      throw new Error('System instructions cannot be empty');
    }

    const {
      organizationId,
      toolNames,
      workflowBindings: _,
      ...agentFields
    } = args;

    // Sync tool list based on retrieval modes
    const syncUpdate: Record<string, unknown> = { toolNames };
    syncRetrievalModes(
      syncUpdate,
      { knowledgeMode: args.knowledgeMode, webSearchMode: args.webSearchMode },
      {
        toolNames,
        knowledgeEnabled: args.knowledgeEnabled,
        knowledgeMode: args.knowledgeMode,
        webSearchMode: args.webSearchMode,
      },
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- syncRetrievalModes guarantees toolNames is string[]
    const syncedToolNames = syncUpdate.toolNames as string[];

    const agentId = await ctx.db.insert('customAgents', {
      organizationId,
      ...agentFields,
      workflowBindings: validatedWorkflowBindings,
      toolNames: syncedToolNames,
      knowledgeEnabled: args.knowledgeMode
        ? args.knowledgeMode !== 'off'
        : args.knowledgeEnabled,
      createdBy: String(authUser._id),
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
    workflowBindings: v.optional(v.array(v.id('wfDefinitions'))),
    modelPreset: v.optional(modelPresetValidator),
    modelId: v.optional(v.string()),
    knowledgeMode: v.optional(retrievalModeValidator),
    webSearchMode: v.optional(retrievalModeValidator),
    knowledgeEnabled: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeTopK: v.optional(v.number()),
    filePreprocessingEnabled: v.optional(v.boolean()),
    structuredResponsesEnabled: v.optional(v.boolean()),
    teamId: v.optional(v.string()),
    delegateAgentIds: v.optional(v.array(v.id('customAgents'))),
    maxSteps: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    outputReserve: v.optional(v.number()),
    roleRestriction: v.optional(roleRestrictionValidator),
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    if (args.toolNames) {
      args.toolNames = filterValidToolNames(args.toolNames);
    }
    validateModelId(args.modelId);
    const validatedWorkflowBindings = await validateWorkflowBindings(
      ctx,
      args.workflowBindings,
      draft.organizationId,
    );

    if (
      args.systemInstructions !== undefined &&
      args.systemInstructions.trim().length === 0
    ) {
      throw new Error('System instructions cannot be empty');
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const {
      customAgentId: _,
      teamId,
      workflowBindings: __,
      ...otherFields
    } = args;

    const cleanUpdate: Record<string, unknown> = Object.fromEntries(
      Object.entries(otherFields).filter(([_k, value]) => value !== undefined),
    );

    if (args.workflowBindings !== undefined) {
      cleanUpdate.workflowBindings = validatedWorkflowBindings;
    }

    if (teamId !== undefined) {
      cleanUpdate.teamId = teamId || undefined;
    }

    // Synchronize tools with retrieval modes
    syncRetrievalModes(
      cleanUpdate,
      { knowledgeMode: args.knowledgeMode, webSearchMode: args.webSearchMode },
      draft,
    );

    await ctx.db.patch(draft._id, cleanUpdate);
    return null;
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
  },
  handler: async (ctx, args): Promise<null> => {
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
    return null;
  },
});

export const updateCustomAgentVisibility = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    visibleInChat: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const draft = await getDraftByRoot(ctx, args.customAgentId);

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    await ctx.db.patch(draft._id, { visibleInChat: args.visibleInChat });
    return null;
  },
});

export const deleteCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) throw new Error('Agent not found');
    const rootId = rootAgent.rootVersionId ?? rootAgent._id;

    if (
      rootAgent.systemAgentSlug &&
      PROTECTED_SYSTEM_SLUGS.has(rootAgent.systemAgentSlug)
    ) {
      throw new Error(
        `Cannot delete the system ${rootAgent.displayName} agent`,
      );
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    // Delete associated webhooks to avoid dangling references
    const webhooks = ctx.db
      .query('customAgentWebhooks')
      .withIndex('by_agent', (q) => q.eq('customAgentId', rootId));
    for await (const webhook of webhooks) {
      await ctx.db.delete(webhook._id);
    }

    const allVersions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', rootId));

    for await (const version of allVersions) {
      await ctx.db.delete(version._id);
    }

    return null;
  },
});

export const duplicateCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args): Promise<Id<'customAgents'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const source =
      (await getVersionByRootAndStatus(ctx, args.customAgentId, 'active')) ??
      (await getVersionByRootAndStatus(ctx, args.customAgentId, 'draft'));
    if (!source) throw new Error('Agent not found');

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
      versionNumber: 1,
      status: 'draft',
      isSystemDefault: undefined,
      systemAgentSlug: undefined,
    });

    await ctx.db.patch(newAgentId, { rootVersionId: newAgentId });

    return newAgentId;
  },
});

export const publishCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<null> => {
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
    return null;
  },
});

export const unpublishCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) throw new Error('Agent not found');

    if (
      rootAgent.systemAgentSlug &&
      PROTECTED_SYSTEM_SLUGS.has(rootAgent.systemAgentSlug)
    ) {
      throw new Error(
        `Cannot deactivate the system ${rootAgent.displayName} agent`,
      );
    }

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
    return null;
  },
});

export const activateCustomAgentVersion = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    targetVersion: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
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
    for await (const version of versions) {
      if (version.versionNumber === args.targetVersion) {
        targetVersion = version;
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
    return null;
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
  handler: async (
    ctx,
    args,
  ): Promise<{ draftId: Id<'customAgents'>; isExisting: boolean }> => {
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
    for await (const version of versions) {
      if (version.versionNumber === args.sourceVersionNumber) {
        source = version;
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
      versionNumber: newVersionNumber,
      status: 'draft',
      rootVersionId: args.customAgentId,
      parentVersionId: source._id,
    });

    return { draftId, isExisting: false };
  },
});
