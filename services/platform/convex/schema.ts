import { defineSchema } from 'convex/server';

import { approvalsTable } from './approvals/schema';
import { auditLogsTable } from './audit_logs/schema';
import { brandingSettingsTable } from './branding/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { customAgentsTable } from './custom_agents/schema';
import { customAgentWebhooksTable } from './custom_agents/webhooks/schema';
import { customersTable } from './customers/schema';
import { documentsTable } from './documents/schema';
import { fileMetadataTable } from './file_metadata/schema';
import { foldersTable } from './folders/schema';
import { integrationsTable } from './integrations/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { ssoProvidersTable } from './sso_providers/schema';
import { messageMetadataTable } from './streaming/schema';
import { threadMetadataTable } from './threads/schema';
import { vendorsTable } from './vendors/schema';
import { websitesTable } from './websites/schema';
import {
  wfDefinitionsTable,
  wfExecutionsTable,
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
  brandingSettings: brandingSettingsTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  customAgents: customAgentsTable,
  customAgentWebhooks: customAgentWebhooksTable,
  customers: customersTable,
  documents: documentsTable,
  fileMetadata: fileMetadataTable,
  folders: foldersTable,
  integrations: integrationsTable,
  messageMetadata: messageMetadataTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  threadMetadata: threadMetadataTable,
  products: productsTable,
  ssoProviders: ssoProvidersTable,
  vendors: vendorsTable,
  websites: websitesTable,
  wfApiKeys: wfApiKeysTable,
  wfDefinitions: wfDefinitionsTable,
  wfEventSubscriptions: wfEventSubscriptionsTable,
  wfExecutions: wfExecutionsTable,
  wfSchedules: wfSchedulesTable,
  wfStepAuditLogs: wfStepAuditLogsTable,
  wfStepDefs: wfStepDefsTable,
  wfTriggerLogs: wfTriggerLogsTable,
  wfWebhooks: wfWebhooksTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
});
