import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * The automation store — the Convex host behind the automation engine's
 * `DispatchStore`. Four tables, each answering one question:
 *
 *  - `automations`           — what versions exist (immutable history)
 *  - `automationDeployments` — which single version triggers run
 *  - `automationTriggers`    — what starts a run
 *  - `automationRuns`        — what happened, step by step
 *
 * The tables were minted under the engine's original workflow names and were
 * renamed to the automation noun before the store ever shipped a release, so
 * one word now runs from the table a row lives in through to the API a caller
 * sees. The rename carries no migration on purpose: nothing outside a
 * development deployment had written those tables, and rows left behind in the
 * old names are deliberately orphaned rather than moved.
 *
 * Versions are IMMUTABLE. The retired model kept one mutable document per
 * automation, so editing a live automation changed what was already running
 * and a failed run could never be reproduced against the document that
 * produced it. Here a save always appends a version, and deploying is a
 * separate, explicit act — which is also what makes the deploy gate
 * meaningful: a version is promoted only once its own tests pass.
 */

/** A stored automation version. The document itself is the engine's v1 shape,
 * validated by the engine rather than re-declared here — Convex would have to
 * mirror the whole node grammar to type it, and the two would drift. */
export const automationsTable = defineTable({
  organizationId: v.string(),
  /** Automation slug — a `/`-separated path, unique per organization. */
  name: v.string(),
  /** 1-based, contiguous per (organization, name). */
  version: v.number(),
  /**
   * Owning project, when the automation lives in a project's Automations tab
   * rather than the org page. Ownership is a property of the NAME: every
   * version of one automation carries the same value (the store enforces it),
   * and the org listing shows only project-less rows.
   */
  projectId: v.optional(v.id('projects')),
  /** The v1 automation document as authored. */
  document: v.any(),
  /** Author-supplied note for the version list. */
  message: v.optional(v.string()),
  /** Whether the version's own tests passed when it was saved — the deploy
   * gate reads this instead of re-running them at promotion time. */
  testsPassed: v.optional(v.boolean()),
  /** The automation's task-surface contract (`taskSubjectContractSchema`) —
   * how the task board choreographs status verbs into runs for tasks this
   * automation owns. Versioned with the document; validated by the writers
   * (zod), stored as JSON like the document itself. */
  taskContract: v.optional(v.any()),
  createdBy: v.string(),
  createdAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_name_version', ['organizationId', 'name', 'version'])
  .index('by_org_project', ['organizationId', 'projectId']);

/**
 * The one live-eligible version per automation. Separate from `automations` so
 * that promoting and rolling back are single writes that never touch history,
 * and so a deployment can be absent — an automation may exist as drafts only.
 */
export const automationDeploymentsTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  version: v.number(),
  deployedBy: v.string(),
  deployedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name']);

/**
 * What starts a run. The kinds are closed and mirror the engine's
 * `TriggerSpec`:
 *
 *  - `schedule` — a cron expression in a named timezone
 *  - `webhook`  — an inbound URL guarded by a token
 *  - `event`    — a platform event name
 *  - `api-key`  — RETIRED. Every write path refuses it (a programmatic start is
 *    what the REST and MCP surfaces are for, so the kind never had a delivery
 *    path of its own); the value stays in the union only so rows written before
 *    it was retired are still readable.
 *
 * The trigger binds to the automation NAME, not to a version, so redeploying
 * never invalidates a webhook URL or a schedule someone else depends on.
 */
export const automationTriggersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  kind: v.union(
    v.literal('schedule'),
    v.literal('webhook'),
    v.literal('event'),
    v.literal('api-key'),
  ),
  /** Cron expression, for `schedule`. */
  cron: v.optional(v.string()),
  /** IANA timezone the cron is read in, for `schedule`. */
  timezone: v.optional(v.string()),
  /** Hashed webhook token — the plaintext is shown once at creation and never
   * stored, matching how every other inbound secret in the platform works. */
  tokenHash: v.optional(v.string()),
  /** Platform event name, for `event`. */
  event: v.optional(v.string()),
  enabled: v.boolean(),
  /** Set when the scheduler last acted on this trigger, so a stuck or
   * drifting schedule is visible without reading the run table. */
  lastFiredAt: v.optional(v.number()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_kind_enabled', ['kind', 'enabled'])
  .index('by_token_hash', ['tokenHash']);

/**
 * Single-use ownership record for an uploaded package blob. The client
 * presigns, POSTs the zip to `_storage`, records the intent, and only then
 * invokes the upload action — which verifies the row binds the storageId to
 * the SAME organization before reading a byte, and deletes it (single-use) in
 * its `finally`. Without this row the action would have to trust a
 * client-supplied storageId, letting any org admin read or delete another
 * tenant's staged blob. Tenant isolation: the row carries the owning
 * `organizationId` and every read compares it against the caller's.
 */
export const automationUploadIntentsTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);

/**
 * One execution. `checkpoints` is what makes the run durable: a live run steps
 * node by node across scheduler invocations, and each completed node records
 * its output here, so an action that hits the Convex time window resumes from
 * the last completed node instead of re-running side effects.
 *
 * `trace` and `effects` are the engine's own result shape, kept whole so the
 * canvas can overlay the last run and so an effect is auditable after the
 * fact.
 */
export const automationRunsTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  version: v.number(),
  /** Denormalized from the automation version's owner, so a project's run log
   * is one index read — never a join over names. */
  projectId: v.optional(v.id('projects')),
  status: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('waiting'),
    v.literal('success'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
  /** `mock` never touches the outside world; `live` may. */
  mode: v.union(v.literal('mock'), v.literal('live')),
  /** What started it — a trigger id, or a caller marker for manual runs. */
  startedBy: v.string(),
  input: v.any(),
  output: v.optional(v.any()),
  /** Per-node results recorded as they complete, keyed by node id. */
  checkpoints: v.optional(v.any()),
  trace: v.optional(v.any()),
  effects: v.optional(v.any()),
  /** Why a run failed or is waiting — an approval id, an error message. */
  detail: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_project', ['organizationId', 'projectId'])
  .index('by_status', ['status']);
