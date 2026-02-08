import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const modelPresetValidator = v.union(
  v.literal('fast'),
  v.literal('standard'),
  v.literal('advanced'),
  v.literal('vision'),
);

export const customAgentsTable = defineTable({
  organizationId: v.string(),

  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),

  systemInstructions: v.string(),
  toolNames: v.array(v.string()),

  modelPreset: modelPresetValidator,
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),

  includeKnowledge: v.boolean(),
  knowledgeTopK: v.optional(v.number()),
  toneOfVoiceId: v.optional(v.id('toneOfVoice')),

  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  createdBy: v.string(),

  isActive: v.boolean(),
  currentVersion: v.number(),
})
  .index('by_organization', ['organizationId'])
  .index('by_organization_active', ['organizationId', 'isActive'])
  .index('by_team', ['teamId'])
  .index('by_creator', ['createdBy']);

export const customAgentVersionsTable = defineTable({
  customAgentId: v.id('customAgents'),
  version: v.number(),

  systemInstructions: v.string(),
  toolNames: v.array(v.string()),
  modelPreset: modelPresetValidator,
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
  includeKnowledge: v.boolean(),
  knowledgeTopK: v.optional(v.number()),

  createdAt: v.number(),
  createdBy: v.string(),
  changeDescription: v.optional(v.string()),
})
  .index('by_agent', ['customAgentId'])
  .index('by_agent_version', ['customAgentId', 'version']);
