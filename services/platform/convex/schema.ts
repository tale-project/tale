import { defineSchema } from 'convex/server';

import { agentRuntimesTable } from './agent_runtimes/schema';
import {
  agentGuardrailNoticesTable,
  agentRunCountersTable,
} from './agents/guardrails/schema';
import {
  agentBindingsTable,
  agentDefaultProvisionsTable,
  agentInstallationsTable,
  autoRouteCacheTable,
} from './agents/schema';
import {
  agentWebhooksTable,
  agentWebhookUserThreadsTable,
} from './agents/webhooks/schema';
import { approvalsTable } from './approvals/schema';
import { auditLogChainGenesisTable, auditLogsTable } from './audit_logs/schema';
import { chatFilterEventsTable } from './chat_filter_events/schema';
import {
  notificationPreferencesTable,
  taskSubscriptionsTable,
  userNotificationsTable,
} from './collab/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { customersTable } from './customers/schema';
import { documentsTable } from './documents/schema';
import { externalRunsTable } from './external_runs/schema';
import { messageFeedbackTable } from './feedback/schema';
import { fileMetadataTable } from './file_metadata/schema';
import { foldersTable } from './folders/schema';
import {
  activeErasureClaimsTable,
  activeLegalHoldClaimsTable,
  auditLogCheckpointsTable,
  dsarPolicyPendingChangesTable,
  gdprErasureRequestsTable,
  governanceSecretsTable,
  legalHoldReleaseRequestsTable,
  legalHoldsTable,
  legalMattersTable,
  orgPackagePolicyTable,
  policyAcknowledgementsTable,
  retentionAppliedBoundsTable,
  retentionPolicyPendingChangesTable,
  retentionRunsTable,
  usageLedgerTable,
} from './governance/schema';
import { externalIdentitiesTable } from './identities/external_identities_schema';
import { integrationCredentialsTable } from './integrations/credentials_schema';
import {
  slackEventDedupTable,
  slackThreadsTable,
} from './integrations/slack/schema';
import { slackInstallationsTable } from './integrations/slack_installations_schema';
import { knowledgeEntriesTable } from './knowledge_entries/schema';
import { configCacheTable } from './lib/config_cache/schema';
import {
  loginAttemptsTable,
  loginBlockCountersTable,
} from './login_attempts/schema';
import { mcpServersTable } from './mcp_servers/schema';
import {
  memberMirrorTable,
  memberMirrorReconcileCursorTable,
  teamMemberMirrorTable,
} from './members/schema';
import {
  migrationLedgerTable,
  migrationSnapshotsTable,
} from './migrations/framework/schema';
import {
  modelCapabilityCacheTable,
  modelCatalogSyncTable,
  modelSyncSettingsTable,
} from './model_catalog/schema';
import { notificationsTable } from './notifications/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { projectsTable } from './projects/schema';
import {
  agentSecretAccessTable,
  projectSecretsTable,
} from './projects/secrets/schema';
import {
  promptCategoriesTable,
  promptDefaultProvisionsTable,
  promptTemplatesTable,
} from './prompts/schema';
import { reasoningProfilesTable } from './reasoning_profiles/schema';
import { sandboxExecutionsTable } from './sandbox/schema';
import {
  sandboxCredentialAccessTable,
  sandboxSessionOpsTable,
  sandboxSessionsTable,
  sandboxSessionTokensTable,
  sandboxIntegrationCallsTable,
  sandboxUserEnvTable,
} from './sandbox/sessions_schema';
import { skillUploadClaimTable, skillUploadIntentTable } from './skills/schema';
import { ssoProvidersTable } from './sso_providers/schema';
import { messageMetadataTable } from './streaming/schema';
import {
  agentTaskMetricsDailyTable,
  taskAgentRunsTable,
  taskMetricsDailyTable,
} from './task_metrics/schema';
import {
  boardViewsTable,
  taskActivityTable,
  taskCommentsTable,
  taskDependenciesTable,
  tasksTable,
} from './tasks/schema';
import { threadFilesTable } from './thread_files/schema';
import { threadTodosTable } from './thread_todos/schema';
import { threadBranchesTable } from './threads/branch_schema';
import { chatMessageQueueTable, threadMetadataTable } from './threads/schema';
import { ttsAudioChunksTable, ttsGcCursorTable } from './tts/schema';
import { twoFactorAttemptsTable } from './two_factor/schema';
import { userMemoriesTable } from './user_memories/schema';
import { userMemoryAuditLogTable } from './user_memory_audit_log/schema';
import { userPreferencesTable } from './user_preferences/schema';
import {
  userNotificationStateTable,
  userPasswordMetadataTable,
} from './users/schema';
import { vendorsTable } from './vendors/schema';
import { videoLinkJobsTable } from './video_links/schema';
import { webdavAppPasswordsTable, webdavLocksTable } from './webdav/schema';
import { websitesTable } from './websites/schema';
import {
  wfDefaultProvisionsTable,
  wfExecutionsTable,
  wfInstallationsTable,
  workflowProcessingRecordsTable,
} from './workflows/schema';
import {
  wfApiKeysTable,
  wfEventSubscriptionsTable,
  wfSchedulesTable,
  wfTriggerLogsTable,
  wfWebhooksTable,
} from './workflows/triggers/schema';

export default defineSchema({
  approvals: approvalsTable,
  auditLogs: auditLogsTable,
  auditLogChainGenesis: auditLogChainGenesisTable,
  // Generic file→cache mirror for all `v8-sync` config domains (governance
  // today). Source of truth is the per-org JSON files under
  // `$TALE_CONFIG_DIR/<org>/governance/`; this table is re-derivable. See
  // `lib/config_cache/schema.ts`.
  configCache: configCacheTable,
  // Versioned data-migration framework. `migrationLedger` records which
  // migrations have applied (and their resume cursors); `migrationSnapshots`
  // holds pre-`up` backups so destructive migrations can be rolled back. See
  // `migrations/framework/`.
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
  governanceSecrets: governanceSecretsTable,
  legalHolds: legalHoldsTable,
  activeLegalHoldClaims: activeLegalHoldClaimsTable,
  legalMatters: legalMattersTable,
  legalHoldReleaseRequests: legalHoldReleaseRequestsTable,
  auditLogCheckpoints: auditLogCheckpointsTable,
  retentionRuns: retentionRunsTable,
  retentionPolicyPendingChanges: retentionPolicyPendingChangesTable,
  dsarPolicyPendingChanges: dsarPolicyPendingChangesTable,
  retentionAppliedBounds: retentionAppliedBoundsTable,
  gdprErasureRequests: gdprErasureRequestsTable,
  activeErasureClaims: activeErasureClaimsTable,
  policyAcknowledgements: policyAcknowledgementsTable,
  chatFilterEvents: chatFilterEventsTable,
  usageLedger: usageLedgerTable,
  promptTemplates: promptTemplatesTable,
  promptCategories: promptCategoriesTable,
  promptDefaultProvisions: promptDefaultProvisionsTable,
  messageFeedback: messageFeedbackTable,
  mcpServers: mcpServersTable,
  // App-native cache of Better Auth `member` rows for the RLS hot path
  // (getUserOrganizations / isOrgMember). Performance optimization only —
  // never the authoritative gate. See `members/schema.ts`.
  memberMirror: memberMirrorTable,
  memberMirrorReconcileCursor: memberMirrorReconcileCursorTable,
  // Local mirror of Better Auth's `teamMember` table — the team-level
  // counterpart of memberMirror, so getUserTeamIds (the other half of the RLS
  // prime) also reads locally instead of cross-component. See members/schema.ts.
  teamMemberMirror: teamMemberMirrorTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  agentBindings: agentBindingsTable,
  agentInstallations: agentInstallationsTable,
  agentDefaultProvisions: agentDefaultProvisionsTable,
  autoRouteCache: autoRouteCacheTable,
  agentWebhooks: agentWebhooksTable,
  agentWebhookUserThreads: agentWebhookUserThreadsTable,
  customers: customersTable,
  documents: documentsTable,
  fileMetadata: fileMetadataTable,
  folders: foldersTable,
  knowledgeEntries: knowledgeEntriesTable,
  integrationCredentials: integrationCredentialsTable,
  slackInstallations: slackInstallationsTable,
  slackThreads: slackThreadsTable,
  slackEventDedup: slackEventDedupTable,
  externalIdentities: externalIdentitiesTable,
  loginAttempts: loginAttemptsTable,
  loginBlockCounters: loginBlockCountersTable,
  messageMetadata: messageMetadataTable,
  notifications: notificationsTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  orgPackagePolicy: orgPackagePolicyTable,
  threadBranches: threadBranchesTable,
  threadFiles: threadFilesTable,
  threadMetadata: threadMetadataTable,
  chatMessageQueue: chatMessageQueueTable,
  threadTodos: threadTodosTable,
  ttsAudioChunks: ttsAudioChunksTable,
  ttsGcCursor: ttsGcCursorTable,
  twoFactorAttempts: twoFactorAttemptsTable,
  userMemories: userMemoriesTable,
  userMemoryAuditLog: userMemoryAuditLogTable,
  userNotificationState: userNotificationStateTable,
  userPasswordMetadata: userPasswordMetadataTable,
  userPreferences: userPreferencesTable,
  products: productsTable,
  projects: projectsTable,
  tasks: tasksTable,
  taskComments: taskCommentsTable,
  taskActivity: taskActivityTable,
  taskDependencies: taskDependenciesTable,
  boardViews: boardViewsTable,
  taskAgentRuns: taskAgentRunsTable,
  taskMetricsDaily: taskMetricsDailyTable,
  agentTaskMetricsDaily: agentTaskMetricsDailyTable,
  agentRunCounters: agentRunCountersTable,
  agentRuntimes: agentRuntimesTable,
  externalRuns: externalRunsTable,
  agentGuardrailNotices: agentGuardrailNoticesTable,
  projectSecrets: projectSecretsTable,
  agentSecretAccess: agentSecretAccessTable,
  userNotifications: userNotificationsTable,
  taskSubscriptions: taskSubscriptionsTable,
  notificationPreferences: notificationPreferencesTable,
  reasoningProfiles: reasoningProfilesTable,
  modelCapabilityCache: modelCapabilityCacheTable,
  modelCatalogSync: modelCatalogSyncTable,
  modelSyncSettings: modelSyncSettingsTable,
  ssoProviders: ssoProvidersTable,
  vendors: vendorsTable,
  sandboxExecutions: sandboxExecutionsTable,
  sandboxSessions: sandboxSessionsTable,
  sandboxSessionTokens: sandboxSessionTokensTable,
  sandboxSessionOps: sandboxSessionOpsTable,
  sandboxCredentialAccess: sandboxCredentialAccessTable,
  sandboxIntegrationCalls: sandboxIntegrationCallsTable,
  sandboxUserEnv: sandboxUserEnvTable,
  skillUploadClaims: skillUploadClaimTable,
  skillUploadIntents: skillUploadIntentTable,
  videoLinkJobs: videoLinkJobsTable,
  webdavAppPasswords: webdavAppPasswordsTable,
  webdavLocks: webdavLocksTable,
  websites: websitesTable,
  wfApiKeys: wfApiKeysTable,
  wfEventSubscriptions: wfEventSubscriptionsTable,
  wfExecutions: wfExecutionsTable,
  wfInstallations: wfInstallationsTable,
  wfDefaultProvisions: wfDefaultProvisionsTable,
  wfSchedules: wfSchedulesTable,
  wfTriggerLogs: wfTriggerLogsTable,
  wfWebhooks: wfWebhooksTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
});
