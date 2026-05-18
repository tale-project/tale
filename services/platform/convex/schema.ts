import { defineSchema } from 'convex/server';

import {
  customAgentsTable,
  customAgentWebhooksTable,
} from './agents/legacy_schema';
import { agentBindingsTable } from './agents/schema';
import {
  agentWebhooksTable,
  agentWebhookUserThreadsTable,
} from './agents/webhooks/schema';
import { approvalsTable } from './approvals/schema';
import { artifactRevisionsTable, artifactsTable } from './artifacts/schema';
import { auditLogChainGenesisTable, auditLogsTable } from './audit_logs/schema';
import {
  brandingBindingsTable,
  brandingSettingsLegacyTable,
} from './branding/schema';
import { chatFilterEventsTable } from './chat_filter_events/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { customersTable } from './customers/schema';
import { documentsTable } from './documents/schema';
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
  policyAcknowledgementsTable,
  retentionAppliedBoundsTable,
  retentionPolicyPendingChangesTable,
  retentionRunsTable,
  usageLedgerTable,
} from './governance/schema';
import { integrationCredentialsTable } from './integrations/credentials_schema';
import { integrationsTable } from './integrations/schema';
import { llmResponseCacheTable } from './lib/response_cache/schema';
import {
  loginAttemptsTable,
  loginBlockCountersTable,
} from './login_attempts/schema';
import { mcpServersTable } from './mcp_servers/schema';
import { notificationsTable } from './notifications/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { promptCategoriesTable, promptTemplatesTable } from './prompts/schema';
import { ssoProvidersTable } from './sso_providers/schema';
import { messageMetadataTable } from './streaming/schema';
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
import { websitesTable } from './websites/schema';
import {
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
  artifactRevisions: artifactRevisionsTable,
  artifacts: artifactsTable,
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
  integrationCredentials: integrationCredentialsTable,
  /** @deprecated Retained for backward compatibility with existing data. Use integrationCredentials + file-based config. */
  integrations: integrationsTable,
  /** @deprecated Retained only for schema-validation compatibility on deployments with prior cache rows. Read/write code removed in 83a3c28da. */
  llmResponseCache: llmResponseCacheTable,
  loginAttempts: loginAttemptsTable,
  loginBlockCounters: loginBlockCountersTable,
  messageMetadata: messageMetadataTable,
  notifications: notificationsTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  threadBranches: threadBranchesTable,
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
  ssoProviders: ssoProvidersTable,
  vendors: vendorsTable,
  websites: websitesTable,
  wfApiKeys: wfApiKeysTable,
  wfDefinitions: wfDefinitionsTable,
  wfEventSubscriptions: wfEventSubscriptionsTable,
  wfExecutions: wfExecutionsTable,
  wfInstallations: wfInstallationsTable,
  wfSchedules: wfSchedulesTable,
  wfStepAuditLogs: wfStepAuditLogsTable,
  wfStepDefs: wfStepDefsTable,
  wfTriggerLogs: wfTriggerLogsTable,
  wfWebhooks: wfWebhooksTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
});
