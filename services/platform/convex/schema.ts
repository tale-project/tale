import { defineSchema } from 'convex/server';

import { agentRuntimesTable } from './agent_runtimes/schema';
import {
  agentGuardrailNoticesTable,
  agentRunCountersTable,
} from './agents/guardrails/schema';
import {
  customAgentsTable,
  customAgentWebhooksTable,
} from './agents/legacy_schema';
import { agentBindingsTable, autoRouteCacheTable } from './agents/schema';
import {
  agentWebhooksTable,
  agentWebhookUserThreadsTable,
} from './agents/webhooks/schema';
import { approvalsTable } from './approvals/schema';
import { auditLogChainGenesisTable, auditLogsTable } from './audit_logs/schema';
import {
  brandingBindingsTable,
  brandingSettingsLegacyTable,
} from './branding/schema';
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
  gdprErasureRequestsTable,
  governancePoliciesTable,
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
import { integrationsTable } from './integrations/schema';
import {
  slackEventDedupTable,
  slackThreadsTable,
} from './integrations/slack/schema';
import { slackInstallationsTable } from './integrations/slack_installations_schema';
import { knowledgeEntriesTable } from './knowledge_entries/schema';
import { llmResponseCacheTable } from './lib/response_cache/schema';
import {
  loginAttemptsTable,
  loginBlockCountersTable,
} from './login_attempts/schema';
import { mcpServersTable } from './mcp_servers/schema';
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
import { promptCategoriesTable, promptTemplatesTable } from './prompts/schema';
import { reasoningProfilesTable } from './reasoning_profiles/schema';
import { sandboxExecutionsTable } from './sandbox/schema';
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
import { threadMetadataTable } from './threads/schema';
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
  wfDefinitionsTable,
  wfExecutionsTable,
  wfInstallationsTable,
  wfStepAuditLogsTable,
  wfStepDefsTable,
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
  governancePolicies: governancePoliciesTable,
  governanceSecrets: governanceSecretsTable,
  legalHolds: legalHoldsTable,
  activeLegalHoldClaims: activeLegalHoldClaimsTable,
  legalMatters: legalMattersTable,
  legalHoldReleaseRequests: legalHoldReleaseRequestsTable,
  auditLogCheckpoints: auditLogCheckpointsTable,
  retentionRuns: retentionRunsTable,
  retentionPolicyPendingChanges: retentionPolicyPendingChangesTable,
  retentionAppliedBounds: retentionAppliedBoundsTable,
  gdprErasureRequests: gdprErasureRequestsTable,
  activeErasureClaims: activeErasureClaimsTable,
  policyAcknowledgements: policyAcknowledgementsTable,
  chatFilterEvents: chatFilterEventsTable,
  usageLedger: usageLedgerTable,
  promptTemplates: promptTemplatesTable,
  promptCategories: promptCategoriesTable,
  messageFeedback: messageFeedbackTable,
  mcpServers: mcpServersTable,
  brandingBindings: brandingBindingsTable,
  /** @deprecated Retained for backward compatibility with existing data. */
  brandingSettings: brandingSettingsLegacyTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  agentBindings: agentBindingsTable,
  autoRouteCache: autoRouteCacheTable,
  agentWebhooks: agentWebhooksTable,
  agentWebhookUserThreads: agentWebhookUserThreadsTable,
  /** @deprecated Retained for backward compatibility with existing data. */
  customAgents: customAgentsTable,
  /** @deprecated Retained for backward compatibility with existing data. */
  customAgentWebhooks: customAgentWebhooksTable,
  customers: customersTable,
  documents: documentsTable,
  fileMetadata: fileMetadataTable,
  folders: foldersTable,
  knowledgeEntries: knowledgeEntriesTable,
  integrationCredentials: integrationCredentialsTable,
  /** @deprecated Retained for backward compatibility with existing data. Use integrationCredentials + file-based config. */
  integrations: integrationsTable,
  slackInstallations: slackInstallationsTable,
  slackThreads: slackThreadsTable,
  slackEventDedup: slackEventDedupTable,
  externalIdentities: externalIdentitiesTable,
  /** @deprecated Retained only for schema-validation compatibility on deployments with prior cache rows. Read/write code removed in 83a3c28da. */
  llmResponseCache: llmResponseCacheTable,
  loginAttempts: loginAttemptsTable,
  loginBlockCounters: loginBlockCountersTable,
  messageMetadata: messageMetadataTable,
  notifications: notificationsTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  orgPackagePolicy: orgPackagePolicyTable,
  threadBranches: threadBranchesTable,
  threadFiles: threadFilesTable,
  threadMetadata: threadMetadataTable,
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
  skillUploadClaims: skillUploadClaimTable,
  skillUploadIntents: skillUploadIntentTable,
  videoLinkJobs: videoLinkJobsTable,
  webdavAppPasswords: webdavAppPasswordsTable,
  webdavLocks: webdavLocksTable,
  websites: websitesTable,
  wfApiKeys: wfApiKeysTable,
  wfDefinitions: wfDefinitionsTable,
  wfEventSubscriptions: wfEventSubscriptionsTable,
  wfExecutions: wfExecutionsTable,
  wfInstallations: wfInstallationsTable,
  wfDefaultProvisions: wfDefaultProvisionsTable,
  wfSchedules: wfSchedulesTable,
  wfStepAuditLogs: wfStepAuditLogsTable,
  wfStepDefs: wfStepDefsTable,
  wfTriggerLogs: wfTriggerLogsTable,
  wfWebhooks: wfWebhooksTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
});
