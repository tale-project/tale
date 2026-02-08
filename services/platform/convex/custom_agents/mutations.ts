/**
 * CRUD mutations for custom agents with auto-versioning.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import { modelPresetValidator } from './schema';
import { TOOL_NAMES } from '../agent_tools/tool_registry';

const toolNamesValidator = v.array(v.string());

const agentFieldsValidator = {
  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  systemInstructions: v.string(),
  toolNames: toolNamesValidator,
  modelPreset: modelPresetValidator,
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
  includeKnowledge: v.boolean(),
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

export const createCustomAgent = mutation({
  args: {
    organizationId: v.string(),
    ...agentFieldsValidator,
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    validateToolNames(args.toolNames);

    const { organizationId, ...agentFields } = args;

    const agentId = await ctx.db.insert('customAgents', {
      organizationId,
      ...agentFields,
      createdBy: String(authUser._id),
      isActive: true,
      currentVersion: 1,
    });

    // Create initial version snapshot
    await ctx.db.insert('customAgentVersions', {
      customAgentId: agentId,
      version: 1,
      systemInstructions: args.systemInstructions,
      toolNames: args.toolNames,
      modelPreset: args.modelPreset,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      maxSteps: args.maxSteps,
      includeKnowledge: args.includeKnowledge,
      knowledgeTopK: args.knowledgeTopK,
      createdAt: Date.now(),
      createdBy: String(authUser._id),
      changeDescription: 'Initial version',
    });

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
    modelPreset: v.optional(modelPresetValidator),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    maxSteps: v.optional(v.number()),
    includeKnowledge: v.optional(v.boolean()),
    knowledgeTopK: v.optional(v.number()),
    toneOfVoiceId: v.optional(v.id('toneOfVoice')),
    teamId: v.optional(v.string()),
    sharedWithTeamIds: v.optional(v.array(v.string())),
    changeDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent || !agent.isActive) throw new Error('Agent not found');

    if (args.toolNames) {
      validateToolNames(args.toolNames);
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const { customAgentId, changeDescription, ...updateFields } = args;

    // Remove undefined values
    const cleanUpdate = Object.fromEntries(
      Object.entries(updateFields).filter(([_, value]) => value !== undefined),
    );

    const newVersion = agent.currentVersion + 1;

    await ctx.db.patch(customAgentId, {
      ...cleanUpdate,
      currentVersion: newVersion,
    });

    // Snapshot the current state after patch
    const updated = await ctx.db.get(customAgentId);
    if (!updated) throw new Error('Agent not found after update');

    await ctx.db.insert('customAgentVersions', {
      customAgentId,
      version: newVersion,
      systemInstructions: updated.systemInstructions,
      toolNames: updated.toolNames,
      modelPreset: updated.modelPreset,
      temperature: updated.temperature,
      maxTokens: updated.maxTokens,
      maxSteps: updated.maxSteps,
      includeKnowledge: updated.includeKnowledge,
      knowledgeTopK: updated.knowledgeTopK,
      createdAt: Date.now(),
      createdBy: String(authUser._id),
      changeDescription,
    });
  },
});

export const deleteCustomAgent = mutation({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    await ctx.db.patch(args.customAgentId, { isActive: false });
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

    const source = await ctx.db.get(args.customAgentId);
    if (!source || !source.isActive) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(source, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    const newName = args.name ?? `${source.name}-copy`;
    const newDisplayName = args.displayName ?? `${source.displayName} (Copy)`;

    const newAgentId = await ctx.db.insert('customAgents', {
      organizationId: source.organizationId,
      name: newName,
      displayName: newDisplayName,
      description: source.description,
      avatarUrl: source.avatarUrl,
      systemInstructions: source.systemInstructions,
      toolNames: source.toolNames,
      modelPreset: source.modelPreset,
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      maxSteps: source.maxSteps,
      includeKnowledge: source.includeKnowledge,
      knowledgeTopK: source.knowledgeTopK,
      toneOfVoiceId: source.toneOfVoiceId,
      teamId: source.teamId,
      sharedWithTeamIds: source.sharedWithTeamIds,
      createdBy: String(authUser._id),
      isActive: true,
      currentVersion: 1,
    });

    await ctx.db.insert('customAgentVersions', {
      customAgentId: newAgentId,
      version: 1,
      systemInstructions: source.systemInstructions,
      toolNames: source.toolNames,
      modelPreset: source.modelPreset,
      temperature: source.temperature,
      maxTokens: source.maxTokens,
      maxSteps: source.maxSteps,
      includeKnowledge: source.includeKnowledge,
      knowledgeTopK: source.knowledgeTopK,
      createdAt: Date.now(),
      createdBy: String(authUser._id),
      changeDescription: `Duplicated from ${source.displayName}`,
    });

    return newAgentId;
  },
});

export const rollbackCustomAgentVersion = mutation({
  args: {
    customAgentId: v.id('customAgents'),
    targetVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent || !agent.isActive) throw new Error('Agent not found');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) {
      throw new Error('Agent not accessible');
    }

    // Find the target version
    const versions = ctx.db
      .query('customAgentVersions')
      .withIndex('by_agent_version', (q) =>
        q.eq('customAgentId', args.customAgentId).eq('version', args.targetVersion),
      );

    let targetVersion = null;
    for await (const v of versions) {
      targetVersion = v;
      break;
    }

    if (!targetVersion) {
      throw new Error(`Version ${args.targetVersion} not found`);
    }

    const newVersion = agent.currentVersion + 1;

    // Apply the snapshot from the target version
    await ctx.db.patch(args.customAgentId, {
      systemInstructions: targetVersion.systemInstructions,
      toolNames: targetVersion.toolNames,
      modelPreset: targetVersion.modelPreset,
      temperature: targetVersion.temperature,
      maxTokens: targetVersion.maxTokens,
      maxSteps: targetVersion.maxSteps,
      includeKnowledge: targetVersion.includeKnowledge,
      knowledgeTopK: targetVersion.knowledgeTopK,
      currentVersion: newVersion,
    });

    // Record the rollback as a new version
    await ctx.db.insert('customAgentVersions', {
      customAgentId: args.customAgentId,
      version: newVersion,
      systemInstructions: targetVersion.systemInstructions,
      toolNames: targetVersion.toolNames,
      modelPreset: targetVersion.modelPreset,
      temperature: targetVersion.temperature,
      maxTokens: targetVersion.maxTokens,
      maxSteps: targetVersion.maxSteps,
      includeKnowledge: targetVersion.includeKnowledge,
      knowledgeTopK: targetVersion.knowledgeTopK,
      createdAt: Date.now(),
      createdBy: String(authUser._id),
      changeDescription: `Rolled back to version ${args.targetVersion}`,
    });
  },
});
