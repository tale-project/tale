import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

/**
 * The automation store — the Convex host behind the automation engine's
 * `DispatchStore`. Five tables, each answering one question:
 *
 *  - `automations`                — what versions exist (immutable history)
 *  - `automationProjectBindings`  — which project surfaces it belongs to
 *  - `automationDeployments`      — which single version triggers run
 *  - `automationTriggers`         — what starts a run
 *  - `automationRuns`             — what happened, step by step
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
   * DEPRECATED — the retired single-pin owner. Project membership lives in
   * `automationProjectBindings` now (one row per bound project); the
   * pins-to-bindings migration moved every pin there and cleared this field,
   * and nothing writes it since. It stays declared so pre-migration rows
   * remain readable and the migration stays reversible.
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
  /** The automation's settings declaration (`automationSettingsSchema`) —
   * operator-editable forms persisted as flat-YAML project files. Versioned
   * and validated exactly like the task contract. */
  settings: v.optional(v.any()),
  /** How the automation names itself to people (`automationPresentationSchema`:
   * `name`, `description`, `icon`, `labels`, `i18n`) — the pack manifest's
   * display half. Absent for canvas-authored automations, whose surfaces read
   * the slug as a title instead. */
  presentation: v.optional(v.any()),
  createdBy: v.string(),
  createdAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_name_version', ['organizationId', 'name', 'version'])
  .index('by_org_project', ['organizationId', 'projectId']);

/**
 * One row per (organization, automation name, project): the automation's
 * membership in a project's surface. The binding SET is the scope — an
 * automation with no rows here is org-level (every project's task board sees
 * it), one with rows is scoped to exactly those projects. Bindings belong to
 * the NAME, not to a version: every version of an automation shares them, the
 * same way deployments and triggers do. Rows are managed explicitly
 * (`setAutomationProjects`, the upload lane's install target) — deleting a
 * project refuses while bindings reference it, so a row never dangles and an
 * automation is never silently rescoped to org-wide.
 */
export const automationProjectBindingsTable = defineTable({
  organizationId: v.string(),
  /** The automation's store name — bindings survive every version append. */
  automationName: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  /** Who bound it — a user id, or a system marker (see `Actor`). */
  boundBy: v.string(),
})
  // One project's automations (task-board surface, project-delete guard).
  .index('by_project', ['projectId'])
  // Prefix-queried three ways: all bindings of an org (listing), all bindings
  // of one automation (scope resolution, reconcile), the exact row (idempotent
  // bind/unbind).
  .index('by_org_name_project', [
    'organizationId',
    'automationName',
    'projectId',
  ]);

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
  /** The project context the run operates in, stamped at start so a project's
   * run log is one index read — never a join over names. A task-surface run
   * carries the TASK's project whatever the automation's own scope; other
   * starts carry the automation's sole bound project when that is unambiguous,
   * and nothing otherwise. */
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
  /**
   * Liveness promise: the instant by which this run must have made another
   * observable move. Declared by every writer of a non-terminal status,
   * renewed by the walker's heartbeat while a node works (so a slow model is
   * never mistaken for a dead run), enforced by the liveness sweep — the only
   * thing that wakes a run whose scheduled resume was lost. Absent on
   * terminal rows; absent-on-old-rows sorts before every number in the index,
   * so pre-field rows are swept first rather than never.
   */
  wakeAt: v.optional(v.number()),
  /** Claim fence: bumped by every claim, carried by every stepper write. A
   * stale walker (a duplicate poke, a resumed zombie) fails its writes
   * instead of double-driving the run. */
  claimEpoch: v.optional(v.number()),
  claimedAt: v.optional(v.number()),
  /** Poll-chain fence: bumped by every park. Exactly one poll chain is live
   * per parked run — a hop carrying an older seq stops itself, so duplicate
   * wakes can never multiply chains. */
  chainSeq: v.optional(v.number()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  /**
   * Retention lifecycle, distinct from `status`: `status` says how the run
   * ENDED, this says whether its record is still kept. The `workflowLog`
   * retention sweep flips an aged terminal run to `expired` (the Trash window
   * an operator can still recover from) and hard-deletes it only after
   * `deletionGraceDays`. Absent means live, so every existing row is retained
   * until a sweep touches it — and the sweep only ever touches TERMINAL runs,
   * because a `waiting` run is parked on a human decision and may legitimately
   * sit for weeks.
   */
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_project', ['organizationId', 'projectId'])
  .index('by_status', ['status'])
  .index('by_status_wakeAt', ['status', 'wakeAt'])
  .index('by_org_lifecycleStatus', ['organizationId', 'lifecycleStatus']);

/**
 * One question an agent turn asked a human (`ask_human`), and its answer. The
 * asking run parks (`waiting`, `agent:<nodeId>`) with its turn ended; the
 * answer resumes the SAME harness conversation (`agentSessionId`) on a fresh
 * exec, so nothing upstream re-runs. The question and answer are mirrored
 * onto the task timeline when the run has a task subject, but THIS row is the
 * contract — a run without a task parks and resumes exactly the same way.
 */
export const automationHumanAsksTable = defineTable({
  organizationId: v.string(),
  runId: v.id('automationRuns'),
  nodeId: v.string(),
  /** The asking turn: the run's sandbox session + the exec that asked. */
  sessionId: v.string(),
  execId: v.string(),
  /** Harness conversation handle captured at the asking turn's end — what the
   * resumed exec passes as `--resume` so the agent keeps its context. */
  agentSessionId: v.optional(v.string()),
  question: v.string(),
  /**
   * The structured question set, when the agent offered choices instead of an
   * open question. OPTIONAL on purpose: a run's blocker often has no
   * enumerable answer ("what is the staging URL?"), unlike chat's clarifying
   * questions, where options are mandatory because the ambiguity is always
   * choice-shaped. `question` stays the human-readable text either way — it
   * is what mirrors onto the task timeline and what a folded ask falls back
   * to.
   */
  questions: v.optional(v.any()),
  status: v.union(
    v.literal('pending'),
    v.literal('answered'),
    v.literal('expired'),
    v.literal('cancelled'),
  ),
  /** Unanswered past this instant, the turn settles as errored (the manifest
   * decides what "no answer" means — comment, todo, escalation). */
  expiresAt: v.number(),
  answer: v.optional(v.string()),
  answeredBy: v.optional(v.string()),
  answeredAt: v.optional(v.number()),
  /** The task whose timeline mirrors the question, when the run has one. */
  taskId: v.optional(v.id('tasks')),
  createdAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_run_status', ['runId', 'status'])
  .index('by_session_exec', ['sessionId', 'execId']);
