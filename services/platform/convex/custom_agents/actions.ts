import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { modelPresetValidator } from './schema';

const toolNamesValidator = v.array(v.string());

export const createCustomAgent = action({
  args: {
    organizationId: v.string(),
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
    filePreprocessingEnabled: v.optional(v.boolean()),
    teamId: v.optional(v.string()),
    sharedWithTeamIds: v.optional(v.array(v.string())),
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args): Promise<Id<'customAgents'>> => {
    return await ctx.runMutation(
      api.custom_agents.mutations.createCustomAgent,
      args,
    );
  },
});

export const duplicateCustomAgent = action({
  args: {
    customAgentId: v.id('customAgents'),
    name: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: v.id('customAgents'),
  handler: async (ctx, args): Promise<Id<'customAgents'>> => {
    return await ctx.runMutation(
      api.custom_agents.mutations.duplicateCustomAgent,
      args,
    );
  },
});

export const publishCustomAgent = action({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(
      api.custom_agents.mutations.publishCustomAgent,
      args,
    );
  },
});

export const unpublishCustomAgent = action({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(
      api.custom_agents.mutations.unpublishCustomAgent,
      args,
    );
  },
});

export const activateCustomAgentVersion = action({
  args: {
    customAgentId: v.id('customAgents'),
    targetVersion: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(
      api.custom_agents.mutations.activateCustomAgentVersion,
      args,
    );
  },
});

export const createDraftFromVersion = action({
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
    return await ctx.runMutation(
      api.custom_agents.mutations.createDraftFromVersion,
      args,
    );
  },
});
