import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../lib/validators/json';
import { executionStatusValidator } from './executions/validators';

export const wfExecutionsTable = defineTable({
  organizationId: v.string(),
  // Holds a file-workflow slug string (DB-backed wfDefinitions removed).
  wfDefinitionId: v.union(v.string(), v.null()),
  rootWfDefinitionId: v.optional(v.string()),
  workflowSlug: v.optional(v.string()),
  workflowVersion: v.optional(v.string()),
  status: executionStatusValidator,
  currentStepSlug: v.string(),
  currentStepName: v.optional(v.string()),
  loopProgress: v.optional(
    v.object({
      current: v.number(),
      total: v.number(),
    }),
  ),
  waitingFor: v.optional(v.string()),
  /** Park-on-capacity: the slug of the sandbox step currently WAITING for a free
   * slot (the org is at its concurrency cap). Set/cleared by `executeSandboxNode`
   * at the admission decision — sticky like chat's `generationQueuedSince`, so
   * the run view shows a steady "Queued" badge instead of flickering Running↔
   * Queued as each ~4s poll segment goes briefly in-progress. Cleared the instant
   * the step is admitted (before the long agent run), so real work reads
   * "Running", not a stale "Queued". */
  awaitingCapacityStepSlug: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  componentWorkflowId: v.optional(v.string()),
  shardIndex: v.optional(v.number()),
  userId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  variables: v.optional(v.string()),
  variablesStorageId: v.optional(v.id('_storage')),
  input: v.optional(jsonValueValidator),
  output: v.optional(jsonValueValidator),
  outputStorageId: v.optional(v.id('_storage')),
  workflowConfig: v.optional(v.string()),
  stepsConfig: v.optional(v.string()),
  stepsConfigStorageId: v.optional(v.id('_storage')),
  triggeredBy: v.optional(v.string()),
  triggerData: v.optional(jsonValueValidator),
  // Generic, polymorphic "what domain resource this run is about" — so any UI
  // component (a task now; a deal/ticket later) can show its run inline by
  // querying executions for its (subjectType, subjectId), without a per-component
  // schema field. Open string set (mirrors the sandbox `ownerType`/`ownerId`
  // doctrine) so new subject kinds never need a migration. Set at start from a
  // generic `subject` the view supplies.
  subjectType: v.optional(v.string()),
  subjectId: v.optional(v.string()),
  error: v.optional(v.string()),
  // Coarse failure classification (see ExecutionErrorCode in executions/types.ts).
  // Kept a plain string in the schema so adding codes never needs a migration.
  errorCode: v.optional(v.string()),
  metadata: v.optional(v.string()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
  // Set once the first transition-to-failed has emitted a `workflow.failed`
  // notification, so the various failure paths (engine callback, stuck-recovery
  // watchdog, start-failure, dynamic next-step) notify exactly once.
  failureNotifiedAt: v.optional(v.number()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_lifecycleStatus', ['organizationId', 'lifecycleStatus'])
  .index('by_definition', ['wfDefinitionId'])
  .index('by_definition_status', ['wfDefinitionId', 'status'])
  .index('by_definition_startedAt', ['wfDefinitionId', 'startedAt'])
  .index('by_definition_triggeredBy_startedAt', [
    'wfDefinitionId',
    'triggeredBy',
    'startedAt',
  ])
  .index('by_status', ['status'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_triggeredBy', ['organizationId', 'triggeredBy'])
  .index('by_component_workflow', ['componentWorkflowId'])
  .index('by_org_workflowSlug', ['organizationId', 'workflowSlug'])
  // Org-scoped scheduler dedup: identical file-workflow slugs exist in every
  // org (default pack), so last-execution / running-execution checks must
  // never cross org lines (a cross-org match starves other orgs' schedules).
  .index('by_org_workflowSlug_startedAt', [
    'organizationId',
    'workflowSlug',
    'startedAt',
  ])
  .index('by_org_workflowSlug_status', [
    'organizationId',
    'workflowSlug',
    'status',
  ])
  // Subject-scoped scan for GDPR Art 17 erasure (`eraseSubjectWfExecutions`).
  // Walks rows where the subject was the executing user. Combined with
  // `by_org_triggeredBy` for the trigger-author scope.
  .index('by_org_user', ['organizationId', 'userId'])
  // "Runs about this domain resource" — drives inline execution display in any
  // UI component (e.g. a task showing its latest run).
  .index('by_org_subject', ['organizationId', 'subjectType', 'subjectId']);

export const wfInstallationsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.string(),
  installedAt: v.number(),
  installedBy: v.string(),
  contentHash: v.string(),
  // Set iff this workflow belongs to an installed app (composite slug
  // `<appSlug>/<name>`). The recorded, authoritative owner — stamped at app
  // install — used by the event-subscription gate, the global app marker, and
  // the delete guard. Absent for global/default-pack workflows.
  appSlug: v.optional(v.string()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'workflowSlug']);

/**
 * One row per (org, workflow) the DEFAULT-PACK provisioner has handled.
 * Existence means "this org got its auto-install once" — an org that later
 * uninstalls the workflow or deactivates its triggers is never re-provisioned
 * behind its back (opt-outs stick across reseeds and upgrades).
 */
export const wfDefaultProvisionsTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.string(),
  contentHash: v.string(),
  provisionedAt: v.number(),
}).index('by_org_slug', ['organizationId', 'workflowSlug']);

/**
 * Per-workflow + per-step env/secrets — one row per
 * (organizationId, workflowSlug, stepSlug, key). Plain vars carry a plaintext
 * `value`; secrets carry an `encryptedValue` (JWE) and are write-only (the read
 * API never returns a secret's plaintext). `stepSlug: ''` is the WORKFLOW-level
 * scope (auto-injected into every sandbox step); a non-empty `stepSlug` is
 * STEP-level (that step only, overriding workflow-level on a key clash).
 * Resolved + injected at sandbox-step execution (decrypt-at-run). Deployment-
 * local on purpose — never written to the portable workflow file. Mirrors
 * `agentEnv`; CRUD in `workflows/workflow_env.ts`, encryption in
 * `workflows/workflow_env_actions.ts`.
 */
export const workflowEnvTable = defineTable({
  organizationId: v.string(),
  /** File-workflow slug (composite app slug ok, e.g. `issue-desk/desk-process`). */
  workflowSlug: v.string(),
  /** '' = workflow-level (all sandbox steps); non-empty = that step only. */
  stepSlug: v.string(),
  /** Env var name (validated `^[A-Za-z_][A-Za-z0-9_]*$`). */
  key: v.string(),
  isSecret: v.boolean(),
  /** Plaintext value for non-secret vars; omitted for secrets. */
  value: v.optional(v.string()),
  /** JWE ciphertext for secrets; omitted for non-secret vars. */
  encryptedValue: v.optional(v.string()),
  /** Low-leak edge preview of a secret (e.g. `sk-••••xyz`) for the editor;
   *  computed at write time, omitted for non-secret vars. */
  maskedPreview: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org_workflow', ['organizationId', 'workflowSlug'])
  .index('by_org_workflow_step', ['organizationId', 'workflowSlug', 'stepSlug'])
  .index('by_org_workflow_step_key', [
    'organizationId',
    'workflowSlug',
    'stepSlug',
    'key',
  ]);

export const workflowProcessingRecordsTable = defineTable({
  organizationId: v.string(),
  tableName: v.string(),
  recordId: v.string(),
  wfDefinitionId: v.string(),
  recordCreationTime: v.number(),
  processedAt: v.number(),
  status: v.optional(v.union(v.literal('in_progress'), v.literal('completed'))),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_org_table_wfDefinition', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
  ])
  .index('by_org_table_wfDefinition_creationTime', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
    'recordCreationTime',
  ])
  .index('by_org_table_wfDefinition_processedAt', [
    'organizationId',
    'tableName',
    'wfDefinitionId',
    'processedAt',
  ])
  .index('by_record', ['tableName', 'recordId', 'wfDefinitionId']);
