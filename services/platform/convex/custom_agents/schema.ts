import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const modelPresetValidator = v.union(
  v.literal('fast'),
  v.literal('standard'),
  v.literal('advanced'),
);

export const retrievalModeValidator = v.union(
  v.literal('off'),
  v.literal('tool'),
  v.literal('context'),
  v.literal('both'),
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

  knowledgeMode: v.optional(retrievalModeValidator),
  webSearchMode: v.optional(retrievalModeValidator),

  // @deprecated — kept for existing documents; derived from knowledgeMode at runtime
  knowledgeEnabled: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  knowledgeTopK: v.optional(v.number()),
  toneOfVoiceId: v.optional(v.id('toneOfVoice')),
  filePreprocessingEnabled: v.optional(v.boolean()),
  structuredResponsesEnabled: v.optional(v.boolean()),

  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  createdBy: v.string(),

  delegateAgentIds: v.optional(v.array(v.id('customAgents'))),

  // @deprecated — kept for existing documents, no longer written or read
  partnerAgentIds: v.optional(v.array(v.id('customAgents'))),
  maxSteps: v.optional(v.number()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  roleRestriction: v.optional(v.string()),
  visibleInChat: v.optional(v.boolean()),

  isSystemDefault: v.optional(v.boolean()),
  systemAgentSlug: v.optional(v.string()),

  // @deprecated — kept for existing documents, no longer written or read
  isActive: v.optional(v.boolean()),

  versionNumber: v.number(),
  status: versionStatusValidator,
  rootVersionId: v.optional(v.id('customAgents')),
  parentVersionId: v.optional(v.id('customAgents')),
  publishedAt: v.optional(v.number()),
  publishedBy: v.optional(v.string()),
  changeLog: v.optional(v.string()),
})
  .index('by_organization', ['organizationId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_root_status', ['rootVersionId', 'status'])
  .index('by_root', ['rootVersionId'])
  .index('by_team', ['teamId'])
  .index('by_creator', ['createdBy'])
  .index('by_org_system_slug', ['organizationId', 'systemAgentSlug']);
