import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const modelPresetValidator = v.union(
  v.literal('fast'),
  v.literal('standard'),
  v.literal('advanced'),
  v.literal('vision'),
);

export const versionStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('archived'),
);

export const customAgentsTable = defineTable({
  organizationId: v.string(),

  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),

  systemInstructions: v.string(),
  toolNames: v.array(v.string()),
  integrationBindings: v.optional(v.array(v.string())),

  modelPreset: modelPresetValidator,

  knowledgeEnabled: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  knowledgeTopK: v.optional(v.number()),
  toneOfVoiceId: v.optional(v.id('toneOfVoice')),

  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  createdBy: v.string(),

  isActive: v.boolean(),

  versionNumber: v.number(),
  status: versionStatusValidator,
  rootVersionId: v.optional(v.id('customAgents')),
  parentVersionId: v.optional(v.id('customAgents')),
  publishedAt: v.optional(v.number()),
  publishedBy: v.optional(v.string()),
  changeLog: v.optional(v.string()),
})
  .index('by_organization', ['organizationId'])
  .index('by_organization_active', ['organizationId', 'isActive'])
  .index('by_org_active_status', ['organizationId', 'isActive', 'status'])
  .index('by_root_status', ['rootVersionId', 'status'])
  .index('by_root', ['rootVersionId'])
  .index('by_team', ['teamId'])
  .index('by_creator', ['createdBy']);
