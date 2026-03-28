import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const modelPresetValidator = v.union(
  v.literal('fast'),
  v.literal('standard'),
  v.literal('advanced'),
);

const retrievalModeValidator = v.union(
  v.literal('off'),
  v.literal('tool'),
  v.literal('context'),
  v.literal('both'),
);

const versionStatusValidator = v.union(
  v.literal('draft'),
  v.literal('active'),
  v.literal('archived'),
);

const roleRestrictionValidator = v.literal('admin_developer');

const knowledgeFileRagStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

const knowledgeFileValidator = v.object({
  fileId: v.id('_storage'),
  fileName: v.string(),
  fileSize: v.optional(v.number()),
  extension: v.optional(v.string()),
  ragStatus: v.optional(knowledgeFileRagStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
});

/** @deprecated Retained for backward compatibility with existing data. Use agentBindings instead. */
export const customAgentsTable = defineTable({
  organizationId: v.string(),

  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),

  systemInstructions: v.string(),
  toolNames: v.array(v.string()),
  integrationBindings: v.optional(v.array(v.string())),
  workflowBindings: v.optional(v.array(v.id('wfDefinitions'))),

  modelPreset: modelPresetValidator,
  modelId: v.optional(v.string()),

  knowledgeMode: v.optional(retrievalModeValidator),
  webSearchMode: v.optional(retrievalModeValidator),

  knowledgeEnabled: v.optional(v.boolean()),
  includeOrgKnowledge: v.optional(v.boolean()),
  includeTeamKnowledge: v.optional(v.boolean()),
  knowledgeFiles: v.optional(v.array(knowledgeFileValidator)),
  knowledgeTopK: v.optional(v.number()),
  filePreprocessingEnabled: v.optional(v.boolean()),
  structuredResponsesEnabled: v.optional(v.boolean()),

  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  createdBy: v.string(),

  delegateAgentIds: v.optional(v.array(v.id('customAgents'))),
  partnerAgentIds: v.optional(v.array(v.id('customAgents'))),
  maxSteps: v.optional(v.number()),
  timeoutMs: v.optional(v.number()),
  outputReserve: v.optional(v.number()),
  roleRestriction: v.optional(roleRestrictionValidator),
  conversationStarters: v.optional(v.array(v.string())),
  visibleInChat: v.optional(v.boolean()),

  isSystemDefault: v.optional(v.boolean()),
  systemAgentSlug: v.optional(v.string()),

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
  .index('by_org_versionNumber', ['organizationId', 'versionNumber'])
  .index('by_root_status', ['rootVersionId', 'status'])
  .index('by_root', ['rootVersionId'])
  .index('by_team', ['teamId'])
  .index('by_creator', ['createdBy'])
  .index('by_org_system_slug', ['organizationId', 'systemAgentSlug']);

/** @deprecated Retained for backward compatibility with existing data. Use agentWebhooks instead. */
export const customAgentWebhooksTable = defineTable({
  organizationId: v.string(),
  customAgentId: v.id('customAgents'),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_agent', ['customAgentId'])
  .index('by_token', ['token']);
