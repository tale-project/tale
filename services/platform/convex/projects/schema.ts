import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const projectModeValidator = v.union(
  v.literal('all'),
  v.literal('recommended'),
  v.literal('restricted'),
);

export const projectKnowledgeModeValidator = v.union(
  v.literal('off'),
  v.literal('tool'),
  v.literal('context'),
  v.literal('both'),
);

export const projectIntegrationsModeValidator = v.union(
  v.literal('all'),
  v.literal('restricted'),
);

/**
 * Project — a named, optionally team-shared workspace that bundles
 * a knowledge-file set, an instruction block, a curated subset of
 * agents/models, and a chat space into one container.
 *
 * Sharing follows the same pattern as `agentBindings`:
 *   teamId empty + sharedWithTeamIds empty → org-wide
 *   else → user must be in at least one of [teamId, ...sharedWithTeamIds]
 *
 * Project instructions are XML-injected into chat system prompts between
 * agent instructions and user personalization (see
 * `lib/agent_response/build_project_instructions.ts`).
 *
 * Files are linked via `documents.projectId`; threads via `threadMetadata.projectId`.
 */
export const projectsTable = defineTable({
  organizationId: v.string(),

  // Identity
  name: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  color: v.optional(v.string()),

  // Sharing — matches agentBindings
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),

  // Behavior — Project instructions are token-capped at 1200 tokens
  // (~6000 chars Zod boundary). Injected via buildProjectInstructions.
  instructions: v.optional(v.string()),
  knowledgeMode: v.optional(projectKnowledgeModeValidator),

  // Agent restriction
  agentMode: v.optional(projectModeValidator),
  recommendedAgentSlugs: v.optional(v.array(v.string())),
  allowedAgentSlugs: v.optional(v.array(v.string())),

  // Model restriction
  modelMode: v.optional(projectModeValidator),
  recommendedModels: v.optional(v.array(v.string())),
  allowedModels: v.optional(v.array(v.string())),

  // Integration restriction (schema only in v1; UI deferred to Phase 7)
  integrationsMode: v.optional(projectIntegrationsModeValidator),
  allowedIntegrationSlugs: v.optional(v.array(v.string())),

  // Lifecycle
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
})
  .index('by_organization', ['organizationId'])
  .index('by_organization_archived', ['organizationId', 'archivedAt'])
  .index('by_organization_updatedAt', ['organizationId', 'updatedAt']);
