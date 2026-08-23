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

export const projectConnectorsModeValidator = v.union(
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
 * Files are linked via `documents.projectId`. Threads: a rebuilt chat thread
 * carries `threads.projectId` (set at creation); discussion/task threads
 * carry `threadMetadata.projectId`. Resolvers in `internal_queries.ts` check
 * both.
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
   * Opaque caller-owned external key (an upstream system's id for this
   * project). Unique within the organization — regardless of lifecycle, so a
   * conflict against an archived project is still a conflict — and never
   * interpreted by the platform. Set at creation; `createProject` stores the
   * trimmed value and probes `by_organization_externalItemId` for duplicates.
   */
  externalItemId: v.optional(v.string()),
  /**
   * Monotonic per-project counter backing task numbering. Incremented on every
   * task insert; a task's `number` is the value it claimed. Never decremented
   * (deleting a task does not recycle its number), so identifiers are stable.
   */
  taskCounter: v.optional(v.number()),

  /**
   * Denormalized task rollups powering the projects-list row — CRITICAL for
   * the at-a-glance progress column, which must not walk the (fat, unbounded)
   * `tasks` table once per project. Maintained by the transition helpers in
   * `tasks/helpers.ts`, which every status/archive/insert/delete path calls;
   * `recomputeProjectRollupCounts` repairs drift. Treat undefined as 0.
   *
   * A task falls in exactly one bucket:
   *
   *   archivedAt !== undefined  → none
   *   status === 'done'         → done
   *   status === 'cancelled'    → none
   *   otherwise                 → open
   *
   * Cancelled tasks are counted NOWHERE on purpose: the row renders progress
   * as `done / (open + done)`, so abandoned work never inflates the
   * denominator and a project that cancels its backlog reads as complete
   * rather than as permanently stalled.
   *
   * Deliberately NOT stored here: an overdue count. Overdue is time-derived
   * (a task crosses its due date with no write to hook), so a stored value
   * would rot silently — the list query derives it per read from
   * `tasks.by_org_dueDate`.
   */
  openTaskCount: v.optional(v.number()),
  doneTaskCount: v.optional(v.number()),
  /**
   * Denormalized count of this project's `projectAgents` rows. Stored rather
   * than derived because `MAX_PROJECT_AGENTS` is 50 — a large org's agent
   * rows can exceed Convex's per-query document ceiling, which would fail the
   * whole list read. Maintained by `createProjectAgent`/`deleteProjectAgent`.
   */
  projectAgentCount: v.optional(v.number()),

  /**
   * DEPRECATED — colour now lives on `taskLabels.color`. Kept optional so
   * deployments mid-migration (strings + sidecar → catalog rows) keep
   * validating; cleared by the labels migration and unused by readers.
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
   * DEPRECATED (never released) — the Phase A per-harness capability binding,
   * replaced by `projectAgents` rows (user-created agent instances). No
   * reader or writer remains; the field stays only so dev deployments whose
   * documents still carry it keep validating. Drop with the next
   * baseline-reset cleanup.
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

  // Connector restriction (schema only in v1; UI deferred to Phase 7)
  connectorsMode: v.optional(projectConnectorsModeValidator),
  allowedConnectorSlugs: v.optional(v.array(v.string())),

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
  .index('by_organization_externalItemId', ['organizationId', 'externalItemId'])
  .index('by_organization_key', ['organizationId', 'key'])
  .index('by_organization_updatedAt', ['organizationId', 'updatedAt']);

/**
 * Single-use handshake row for the projects REST upload lane:
 * `POST /api/v1/projects/{id}/uploads` mints one alongside a backend-aware
 * upload handoff, and `POST /api/v1/projects/{id}/files` consumes it when the
 * blob is bound as a project file. The row pins the handoff to
 * `(organizationId, userId, projectId)` so the bind step never trusts a
 * caller-supplied blob reference: an S3 handoff admits only the exact `s3Ref`
 * it presigned; a Convex handoff admits only a valid, still-unclaimed
 * `_storage` id. The row's own `_id` IS the wire `uploadId` (unguessable).
 *
 * TTL'd (60 minutes, `REST_UPLOAD_INTENT_TTL_MS`) and lazily swept on every
 * mint — see `projects/rest_upload_intents.ts`. Tenant isolation: the row
 * carries the owning `organizationId` and consume compares it against the
 * caller's before anything else.
 */
export const restUploadIntentsTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  projectId: v.id('projects'),
  /** Present iff the handoff was a presigned S3 PUT — the exact blob
   * reference the bind step must claim (and the sweep can reclaim). */
  s3Ref: v.optional(v.string()),
  createdAt: v.number(),
}).index('by_organizationId', ['organizationId']);

/**
 * A user-created agent of a project: a named worker bound to one sandbox
 * harness, pre-equipped with the skills/connectors it runs with and carrying
 * an instructions addendum the run lane delivers through the harness's
 * system-prompt channel (`HarnessRunSpec.instructions`). Replaces the
 * retired per-harness `agentCapabilities` binding — the project Agents tab
 * creates/edits these, and tasks assign work to them (`assigneeType 'agent'`,
 * `assigneeId` = this row's id).
 *
 * `harness` is a managed harness slug (the project Agents roster);
 * byo-only harnesses (cursor) are ineligible — no managed lane, and composed
 * instructions have no delivery channel there. Instances deliberately carry
 * a model pin chosen at create time — the harness drives that model in the
 * sandbox.
 */
export const projectAgentsTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  name: v.string(),
  harness: v.string(),
  /**
   * The model the agent's turns call, as a composer model id resolved at run
   * time via `resolveServingTarget`. Required at write (the dialog demands a
   * choice); optional in the schema only for rows created before the field.
   */
  model: v.optional(v.string()),
  /**
   * The provider slug whose credential serves `model` — the dialog's pick,
   * honored fail-closed at run time (a pinned provider that cannot serve
   * fails the run rather than silently billing another provider). Absent on
   * rows saved before the picker carried providers; those keep the legacy
   * first-match connector walk.
   */
  modelProvider: v.optional(v.string()),
  skills: v.array(v.string()),
  connectors: v.array(v.string()),
  /**
   * Workspace tools granted BEYOND the lane baseline — names validated
   * against `AGENT_TOOL_CATALOG` (`sandbox/tool_names.ts`). A `write`-effect
   * grant is the standing authorization for that write (no per-call approval
   * on the async lanes), so it is always an explicit pick, never defaulted.
   * Optional only for rows created before the field; absent reads as [].
   */
  tools: v.optional(v.array(v.string())),
  /**
   * Names of org `agentSecrets` rows injected into this agent's turns as
   * per-exec environment variables (BYO API keys for services outside the
   * connector catalog). NAMES only — values live JWE-encrypted on the
   * secrets table and never on this row. Absent reads as [].
   */
  secrets: v.optional(v.array(v.string())),
  instructions: v.optional(v.string()),
  /**
   * Rolling-upgrade compatibility for rows written before autonomy tiers were
   * removed. Runtime code ignores this field; keeping its validator optional
   * lets existing deployments adopt the removal without deleting user data.
   */
  autonomyTier: v.optional(
    v.union(v.literal('a1'), v.literal('a2'), v.literal('a3')),
  ),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_project', ['projectId'])
  .index('by_organization', ['organizationId']);
