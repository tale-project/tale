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

  /**
   * Immutable short key prefixing human-readable task identifiers (e.g. `TAL`
   * → tasks `TAL-1`, `TAL-2`). Set once at creation (derived from the name or
   * chosen by the user), unique within the organization, never editable after.
   * Optional only for backward-compat with projects created before keys.
   */
  key: v.optional(v.string()),
  /**
   * Monotonic per-project counter backing task numbering. Incremented on every
   * task insert; a task's `number` is the value it claimed. Never decremented
   * (deleting a task does not recycle its number), so identifiers are stable.
   */
  taskCounter: v.optional(v.number()),
  /**
   * Per-project colour overrides for task labels, keyed by the normalized
   * (lowercase) label. Values are palette names from
   * `lib/shared/task-label-colors.ts`; labels without an entry fall back to
   * the client's deterministic palette hash. Written via `tasks/setLabelColor`.
   */
  taskLabelColors: v.optional(v.record(v.string(), v.string())),

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

  /**
   * Per-project, per-agent capability binding. For each fixed agent (the
   * platform assistant slug or a third-party harness slug), the skills and
   * connectors the user equipped it with IN THIS PROJECT — the persistent,
   * project-scoped analog of a chat thread's `capabilities`. An agent runs in
   * this project with exactly the skills/connectors bound here; an agent with
   * no entry falls back to its default. Keyed by agent id (a record, like
   * `taskLabelColors`); skills are org skill slugs, connectors are
   * enabled-connector slugs. Consumed by the run lane, never interpreted here.
   */
  agentCapabilities: v.optional(
    v.record(
      v.string(),
      v.object({
        skills: v.array(v.string()),
        connectors: v.array(v.string()),
      }),
    ),
  ),

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
  /**
   * When set, the project is pinned in the chat-history sidebar and sorts
   * above unpinned projects (most-recently-pinned first). `undefined`
   * means not pinned. Toggled via `setProjectPinned`.
   */
  pinnedAt: v.optional(v.number()),
})
  .index('by_organization', ['organizationId'])
  .index('by_organization_archived', ['organizationId', 'archivedAt'])
  .index('by_organization_key', ['organizationId', 'key'])
  .index('by_organization_updatedAt', ['organizationId', 'updatedAt']);
