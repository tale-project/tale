/**
 * Shared test scaffolding for migration round-trip tests.
 *
 *  - The exported LEGACY TABLE definitions describe removed tables (e.g.
 *    `governancePolicies`) at their pre-migration shapes; the union
 *    `testing/world_schema.testkit.ts` assembles them (plus current tables)
 *    into the schema every migration test and the chain harness run against.
 *  - `buildModules` normalizes an `import.meta.glob` result (whose keys are
 *    relative to the TEST file) into the convex-root-relative keys `convexTest`
 *    expects. Each test passes its own glob + its own dir-from-convex-root
 *    because `import.meta.glob` must take a string literal.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { dataSourceValidator } from '../../lib/validators/common';
import { jsonRecordValidator } from '../../lib/validators/json';

/**
 * The legacy `governancePolicies` table as it existed at v0.2.84, before
 * governance settings moved to per-org JSON files. Declared here (not in the
 * production schema) so the 0.2.85 governance migrations can be round-trip
 * tested.
 */
export const legacyGovernancePoliciesTable = defineTable({
  organizationId: v.string(),
  policyType: v.string(),
  config: v.any(),
  enabled: v.optional(v.boolean()),
  updatedBy: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  effectiveAt: v.optional(v.number()),
  pendingConfig: v.optional(v.any()),
  pendingEffectiveAt: v.optional(v.number()),
  pendingProposedBy: v.optional(v.string()),
  pendingProposedByEmail: v.optional(v.string()),
  pendingProposedAt: v.optional(v.number()),
}).index('by_organizationId', ['organizationId']);

/**
 * The legacy `orgPackagePolicy` / `modelSyncSettings` tables as they existed at
 * v0.2.86, before the `run_code` / `model_sync` governance policies became
 * file-based. Declared here so the 0.2.87 cutover migrations can be round-trip
 * tested.
 */
export const legacyOrgPackagePolicyTable = defineTable({
  organizationId: v.string(),
  defaultMode: v.union(v.literal('allowlist'), v.literal('denylist')),
  pythonAllow: v.array(v.string()),
  pythonDeny: v.array(v.string()),
  nodeAllow: v.array(v.string()),
  nodeDeny: v.array(v.string()),
  updatedAt: v.optional(v.number()),
  updatedByUserId: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);

export const legacyModelSyncSettingsTable = defineTable({
  organizationId: v.string(),
  autoSyncEnabled: v.boolean(),
  updatedAt: v.optional(v.number()),
}).index('by_organizationId', ['organizationId']);

/**
 * The retired AI-provider cache/governor tables as they existed when the
 * 0.4.0 providers rewrite drained them (0.4.0/03–/05) and dropped them from
 * the production schema. Shapes are byte-faithful to the last shipped
 * declarations so the drop migrations can be round-trip tested and the chain
 * world can carry baseline rows.
 */
const legacyReasoningBucket = v.object({
  count: v.number(),
  mean: v.number(),
  m2: v.number(),
  underResourcedEma: v.number(),
  wastefulEma: v.optional(v.number()),
  qualityEma: v.optional(v.number()),
  lastTier: v.optional(
    v.union(
      v.literal('off'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
    ),
  ),
});

export const legacyReasoningProfilesTable = defineTable({
  organizationId: v.string(),
  scopeKey: v.string(),
  state: v.object({
    easy: legacyReasoningBucket,
    medium: legacyReasoningBucket,
    hard: legacyReasoningBucket,
    turns: v.number(),
    intensityCount: v.optional(v.number()),
    intensityMean: v.optional(v.number()),
    intensityM2: v.optional(v.number()),
  }),
  updatedAt: v.number(),
}).index('by_org_scope', ['organizationId', 'scopeKey']);

export const legacyModelCapabilityCacheTable = defineTable({
  modelId: v.string(),
  reasoning: v.optional(
    v.object({
      knob: v.union(
        v.literal('effort'),
        v.literal('budgetTokens'),
        v.literal('none'),
      ),
      supportsMinimal: v.optional(v.boolean()),
      minBudgetTokens: v.optional(v.number()),
      maxBudgetTokens: v.optional(v.number()),
    }),
  ),
  promptCaching: v.optional(
    v.object({
      mode: v.union(
        v.literal('explicit-breakpoints'),
        v.literal('auto-server'),
        v.literal('none'),
      ),
      maxBreakpoints: v.optional(v.number()),
    }),
  ),
  inputCentsPerMillion: v.optional(v.number()),
  outputCentsPerMillion: v.optional(v.number()),
  contextWindow: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  supportsTools: v.optional(v.boolean()),
  supportsVision: v.optional(v.boolean()),
  source: v.string(),
  fetchedAt: v.number(),
}).index('by_modelId', ['modelId']);

export const legacyModelCatalogSyncTable = defineTable({
  source: v.string(),
  lastSyncedAt: v.number(),
  modelCount: v.number(),
  ok: v.boolean(),
  error: v.optional(v.string()),
}).index('by_source', ['source']);

/**
 * Legacy `appInstallations`/`appProjectBindings` table names (pre-0.2.93 /04–/05)
 * as they existed through v0.2.90, before `config` (the automation manifest's
 * retired `requires.config` values) was dropped in the 0.2.91 config-to-schedule-variables
 * cutover. The live schema (`automations/schema.ts`) uses `automationInstallations` /
 * `automationProjectBindings`; these legacy-named tables remain here so 0.2.88/0.2.91
 * migration round-trip tests can seed the OLD (config-bearing) shape.
 */
export const legacyAppInstallationsWithConfigTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  appName: v.optional(v.string()),
  installedAt: v.number(),
  installedBy: v.string(),
  status: v.union(v.literal('active'), v.literal('broken')),
  uninstalling: v.optional(v.boolean()),
  requiredConnectors: v.array(v.string()),
  resources: v.array(
    v.object({
      domain: v.string(),
      path: v.string(),
      contentHash: v.string(),
      adopted: v.optional(v.boolean()),
    }),
  ),
  config: v.optional(jsonRecordValidator),
})
  .index('by_org', ['organizationId'])
  .index('by_org_slug', ['organizationId', 'appSlug']);

export const legacyAppProjectBindingsWithConfigTable = defineTable({
  organizationId: v.string(),
  appSlug: v.string(),
  projectId: v.id('projects'),
  boundAt: v.number(),
  boundBy: v.string(),
  config: v.optional(jsonRecordValidator),
})
  .index('by_project', ['projectId'])
  .index('by_org_slug_project', ['organizationId', 'appSlug', 'projectId']);

/**
 * Pre-0.3.4 `customers` + `vendors` tables, dropped in the Customers +
 * Vendors → Contacts merge (issue #2618). Declared here so the 0.3.4 backfill
 * migrations (22/23 contacts-from-{vendors,customers}) can seed the OLD
 * shape and round-trip. Minimal — only the fields those tests read/write.
 * The `customerId` link these tables' FK once pointed at still lives
 * transitionally on the PRODUCTION `conversations` / `supportCases` tables
 * (see the pre-drop comments there): the real backend validates the corpus
 * seed and the 0.3.4/24-28 + 31/32 writes against the production defs, so
 * the field can only leave them once the chain baseline has advanced past
 * the teardown migrations.
 */
export const legacyCustomersTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  status: v.optional(
    v.union(v.literal('active'), v.literal('churned'), v.literal('potential')),
  ),
  source: dataSourceValidator,
  locale: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
}).index('by_organizationId', ['organizationId']);

export const legacyVendorsTable = defineTable({
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: dataSourceValidator,
  locale: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
}).index('by_organizationId', ['organizationId']);

/**
 * The 17 retired AI-backend tables the 0.4.0 drop migrations (0.4.0/06–/22)
 * drain and remove from the production schema. Each def is faithful to the last
 * shipped shape so the drop migrations round-trip and the chain world can carry
 * its rows. Cross-table `v.id(...)` columns that point at tables the world
 * schema does not declare are widened to `v.string()`: `convex-test` needs a
 * real id to accept a live `v.id`, the structural release validator checks ids
 * as strings anyway, and the drop deletes rows by `_id`, so the column's static
 * type never changes what is snapshotted or restored.
 */

/** Qualitative response-shaping the retired auto-router advised per message. */
const legacyRouteTuning = v.object({
  style: v.optional(
    v.union(
      v.literal('concise'),
      v.literal('detailed'),
      v.literal('formal'),
      v.literal('friendly'),
    ),
  ),
  verbosity: v.optional(
    v.union(v.literal('terse'), v.literal('normal'), v.literal('verbose')),
  ),
});

/** Coarse per-message reasoning seed the retired auto-router advised. */
const legacyRouteSeed = v.object({
  effort: v.optional(
    v.union(v.literal('low'), v.literal('medium'), v.literal('high')),
  ),
  creativity: v.optional(
    v.union(v.literal('precise'), v.literal('balanced'), v.literal('creative')),
  ),
});

export const legacyAutoRouteCacheTable = defineTable({
  organizationId: v.string(),
  candidatesHash: v.string(),
  messageKey: v.string(),
  agentSlug: v.string(),
  source: v.union(v.literal('classified'), v.literal('override')),
  language: v.optional(v.string()),
  tuning: v.optional(legacyRouteTuning),
  seed: v.optional(legacyRouteSeed),
  capabilities: v.optional(v.array(v.string())),
  hits: v.number(),
  createdAt: v.number(),
  lastUsedAt: v.number(),
})
  .index('by_org_candidates_message', [
    'organizationId',
    'candidatesHash',
    'messageKey',
  ])
  .index('by_createdAt', ['createdAt']);

export const legacyMcpServersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  transportType: v.union(
    v.literal('stdio'),
    v.literal('sse'),
    v.literal('streamable_http'),
  ),
  url: v.optional(v.string()),
  command: v.optional(v.string()),
  args: v.optional(v.array(v.string())),
  env: v.optional(jsonRecordValidator),
  authType: v.union(
    v.literal('none'),
    v.literal('api_key'),
    v.literal('oauth2'),
  ),
  apiKeyEncrypted: v.optional(v.string()),
  oauth2Config: v.optional(
    v.object({
      tokenUrl: v.string(),
      authorizationUrl: v.optional(v.string()),
      clientId: v.string(),
      clientSecretEncrypted: v.string(),
      scopes: v.array(v.string()),
      grantType: v.union(
        v.literal('client_credentials'),
        v.literal('authorization_code'),
      ),
    }),
  ),
  oauth2Tokens: v.optional(
    v.object({
      accessTokenEncrypted: v.string(),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
    }),
  ),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
    v.literal('discovering'),
  ),
  capabilities: v.optional(
    v.object({
      tools: v.optional(v.boolean()),
      resources: v.optional(v.boolean()),
      prompts: v.optional(v.boolean()),
    }),
  ),
  discoveredTools: v.optional(
    v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        inputSchema: v.optional(jsonRecordValidator),
        requiresApproval: v.optional(v.boolean()),
      }),
    ),
  ),
  lastConnectedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_status', ['organizationId', 'status']);

export const legacySkillUploadClaimTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

export const legacySkillUploadIntentTable = defineTable({
  // `_storage` id in production; widened (see the group header).
  storageId: v.string(),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);

export const legacySlackEventDedupTable = defineTable({
  eventId: v.string(),
  expiresAt: v.number(),
})
  .index('by_eventId', ['eventId'])
  .index('by_expiresAt', ['expiresAt']);

export const legacySlackInstallationsTable = defineTable({
  teamId: v.string(),
  teamName: v.optional(v.string()),
  enterpriseId: v.optional(v.string()),
  organizationId: v.string(),
  slug: v.string(),
  botUserId: v.optional(v.string()),
  appId: v.optional(v.string()),
  // `connectorCredentials` id in production; widened (see the group header).
  credentialId: v.string(),
  installedAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_team', ['teamId'])
  .index('by_organizationId', ['organizationId'])
  .index('by_credentialId', ['credentialId']);

export const legacyTtsGcCursorTable = defineTable({
  job: v.string(),
  lastOrgId: v.union(v.string(), v.null()),
  updatedAt: v.number(),
}).index('by_job', ['job']);

export const legacyWfApiKeysTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  isActive: v.boolean(),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_keyHash', ['keyHash']);

export const legacyWfWebhooksTable = defineTable({
  organizationId: v.string(),
  workflowSlug: v.optional(v.string()),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_workflowSlug', ['workflowSlug'])
  .index('by_token', ['token']);

export const legacyWorkflowProcessingRecordsTable = defineTable({
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

/**
 * The retired per-agent env/secret store, one row per (org, agent, key), as
 * it existed before 0.4.0/36 drained it. An agent carries no credentials any
 * more, so the production schema no longer declares this table; the shape
 * lives here for the chain.
 */
export const legacyAgentEnvTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  /** Env var name (validated `^[A-Za-z_][A-Za-z0-9_]*$`). */
  key: v.string(),
  isSecret: v.boolean(),
  /** Plaintext value for non-secret vars; omitted for secrets. */
  value: v.optional(v.string()),
  /** JWE ciphertext for secrets; omitted for non-secret vars. */
  encryptedValue: v.optional(v.string()),
  /** Low-leak edge preview of a secret; omitted for non-secret vars. */
  maskedPreview: v.optional(v.string()),
  /** When set, this row is a token-source binding, not a literal value. */
  tokenSourceSlug: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.string(),
})
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_org_agent_key', ['organizationId', 'agentSlug', 'key']);

export const legacyAgentDefaultProvisionsTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  contentHash: v.string(),
  provisionedAt: v.number(),
}).index('by_org_slug', ['organizationId', 'agentSlug']);

export const legacyAgentRunCountersTable = defineTable({
  organizationId: v.string(),
  scope: v.string(),
  running: v.number(),
  updatedAt: v.number(),
}).index('by_org_scope', ['organizationId', 'scope']);

const legacyRuntimeCapabilities = v.object({
  jsonOutput: v.boolean(),
  sessionResume: v.boolean(),
  costReporting: v.boolean(),
  mcp: v.boolean(),
});

export const legacyAgentRuntimesTable = defineTable({
  organizationId: v.string(),
  daemonId: v.string(),
  adapterType: v.string(),
  name: v.optional(v.string()),
  version: v.optional(v.string()),
  capabilities: v.optional(legacyRuntimeCapabilities),
  workspaceKeys: v.optional(v.array(v.string())),
  createdBy: v.string(),
  registeredAt: v.number(),
  lastHeartbeatAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_daemon', ['organizationId', 'daemonId'])
  .index('by_org_daemon_adapter', [
    'organizationId',
    'daemonId',
    'adapterType',
  ]);

export const legacyAgentTaskMetricsDailyTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  dateKey: v.string(),
  runsStarted: v.number(),
  runsCompleted: v.number(),
  runsFailed: v.number(),
  runDurationSumMs: v.number(),
  runDurationCount: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),
  tasksCompleted: v.number(),
  reviewsPassed: v.number(),
  reviewsChangesRequested: v.number(),
  escalations: v.number(),
  staleEod: v.number(),
  computedAt: v.number(),
})
  .index('by_org_agent_date', ['organizationId', 'agentSlug', 'dateKey'])
  .index('by_org_date', ['organizationId', 'dateKey']);

export const legacyChatMessageQueueTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  userId: v.string(),
  userEmail: v.string(),
  userName: v.string(),
  agentSlug: v.string(),
  modelId: v.optional(v.string()),
  messageId: v.string(),
  savedMessageId: v.optional(v.string()),
  deferredPersist: v.optional(v.boolean()),
  text: v.string(),
  status: v.union(
    v.literal('waiting_media'),
    v.literal('queued'),
    v.literal('claimed'),
    v.literal('delivered'),
    v.literal('consumed'),
  ),
  claimedByStreamId: v.optional(v.string()),
  deliveredExecId: v.optional(v.string()),
  deliveredChannel: v.optional(v.union(v.literal('file'), v.literal('stdin'))),
  createdAt: v.number(),
  claimedAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  attachments: v.optional(
    v.array(
      v.object({
        // `blobRefValidator` (accepts a plain string); inlined.
        fileId: v.union(v.id('_storage'), v.string()),
        fileName: v.string(),
        fileType: v.string(),
        fileSize: v.number(),
      }),
    ),
  ),
  // `v.array(v.id('videoLinkJobs'))` in production; widened (see group header).
  videoJobIds: v.optional(v.array(v.string())),
  waitingSince: v.optional(v.number()),
})
  .index('by_threadId_status', ['threadId', 'status'])
  .index('by_organizationId', ['organizationId']);

const legacyExternalRunStatus = v.union(
  v.literal('queued'),
  v.literal('claimed'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

const legacyExternalRunPermissionMode = v.union(
  v.literal('safe'),
  v.literal('auto_edits'),
  v.literal('full_auto'),
);

const legacyTaskAgentRunTrigger = v.union(
  v.literal('assignment'),
  v.literal('mention'),
  v.literal('revision'),
  v.literal('sla_escalation'),
  v.literal('unblock'),
  v.literal('decomposition'),
  v.literal('manual'),
);

export const legacyExternalRunsTable = defineTable({
  organizationId: v.string(),
  // `tasks` / `projects` / `taskAgentRuns` ids in production; widened (see the
  // group header).
  taskId: v.string(),
  projectId: v.string(),
  agentSlug: v.string(),
  adapterType: v.string(),
  daemonId: v.optional(v.string()),
  workspaceKey: v.optional(v.string()),
  permissionMode: legacyExternalRunPermissionMode,
  kind: v.union(v.literal('initial'), v.literal('revision')),
  trigger: legacyTaskAgentRunTrigger,
  resumeSessionRef: v.optional(v.string()),
  prompt: v.string(),
  status: legacyExternalRunStatus,
  failReason: v.optional(v.string()),
  attempts: v.number(),
  maxAttempts: v.number(),
  cancelRequested: v.optional(v.boolean()),
  claimedByDaemonId: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  guardBudget: v.optional(
    v.object({
      monthlyCents: v.number(),
      warnPct: v.optional(v.number()),
      pausePct: v.optional(v.number()),
    }),
  ),
  guardMaxConcurrentTasks: v.optional(v.number()),
  runId: v.optional(v.string()),
  wfExecutionId: v.optional(v.string()),
  workflowSlug: v.optional(v.string()),
  sessionRef: v.optional(v.string()),
  resultSummary: v.optional(v.string()),
  diffStat: v.optional(v.string()),
  createdAt: v.number(),
  dispatchDeadlineAt: v.number(),
  claimedAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  timeoutAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_adapter_status', ['organizationId', 'adapterType', 'status'])
  .index('by_org_agent_status', ['organizationId', 'agentSlug', 'status'])
  .index('by_org_created', ['organizationId', 'createdAt'])
  .index('by_task', ['taskId'])
  .index('by_daemon_status', ['claimedByDaemonId', 'status']);

const legacyAgentJobStatus = v.union(
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('timed_out'),
  v.literal('cancelled'),
);

const legacyAgentJobFailureReason = v.union(
  v.literal('generation_error'),
  v.literal('deadline_exceeded'),
  v.literal('budget_exhausted'),
  v.literal('orphaned'),
);

const legacyAgentJobProgressItem = v.object({
  id: v.string(),
  content: v.string(),
  status: v.union(
    v.literal('pending'),
    v.literal('in_progress'),
    v.literal('done'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
  note: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const legacyAgentJobSpec = v.object({
  instructions: v.string(),
  input: v.string(),
  methodologySlug: v.optional(v.string()),
  methodologyVersionHash: v.optional(v.string()),
  renderedMethodology: v.optional(v.string()),
  requestedTools: v.array(v.string()),
  effectiveTools: v.array(v.string()),
  skills: v.array(v.string()),
  connectors: v.array(v.string()),
  modelTier: v.optional(v.union(v.literal('fast'), v.literal('capable'))),
  model: v.string(),
  provider: v.optional(v.string()),
  narrowed: v.object({
    tools: v.array(v.string()),
    skills: v.array(v.string()),
    connectors: v.array(v.string()),
    methodology: v.optional(v.string()),
  }),
});

export const legacyAgentJobsTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  jobThreadId: v.string(),
  toolCallId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  userId: v.optional(v.string()),
  parentAgentSlug: v.string(),
  name: v.string(),
  description: v.string(),
  status: legacyAgentJobStatus,
  failureReason: v.optional(legacyAgentJobFailureReason),
  specVersion: v.number(),
  spec: legacyAgentJobSpec,
  progress: v.array(legacyAgentJobProgressItem),
  activeProgressId: v.optional(v.string()),
  recentOpIds: v.array(v.string()),
  resultText: v.optional(v.string()),
  inputTokens: v.number(),
  outputTokens: v.number(),
  costCents: v.number(),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
})
  .index('by_job_thread', ['jobThreadId'])
  .index('by_thread', ['threadId'])
  .index('by_org_status_completed', [
    'organizationId',
    'status',
    'completedAt',
  ]);

/** Normalize one glob key relative to the convex root, resolving `..`. */
function toConvexRootKey(dirFromRoot: string, globKey: string): string {
  const stack: string[] = [];
  for (const part of `${dirFromRoot}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * Convert an `import.meta.glob` result into the `{ 'path/from/convex/root': loader }`
 * map `convexTest` wants.
 *
 * @param rawModules result of `import.meta.glob('<…>/**\/*.*s')` in the test file
 * @param dirFromRoot the test file's directory relative to `convex/`
 */
export function buildModules(
  rawModules: Record<string, () => Promise<unknown>>,
  dirFromRoot: string,
): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  for (const [key, loader] of Object.entries(rawModules)) {
    modules[toConvexRootKey(dirFromRoot, key)] = loader;
  }
  return modules;
}
