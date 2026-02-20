import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const modelPresetValidator = v.union(
  v.literal('fast'),
  v.literal('standard'),
  v.literal('advanced'),
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
  filePreprocessingEnabled: v.optional(v.boolean()),

  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  createdBy: v.string(),

  partnerAgentIds: v.optional(v.array(v.id('customAgents'))),
  maxSteps: v.optional(v.number()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  roleRestriction: v.optional(v.string()),

  isSystemDefault: v.optional(v.boolean()),
  systemAgentSlug: v.optional(v.string()),

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
  .index('by_org_active_status', ['organizationId', 'isActive', 'status'])
  .index('by_root_status', ['rootVersionId', 'status'])
  .index('by_root', ['rootVersionId'])
  .index('by_team', ['teamId'])
  .index('by_creator', ['createdBy'])
  .index('by_org_system_slug', ['organizationId', 'systemAgentSlug']);
