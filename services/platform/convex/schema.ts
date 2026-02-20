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
import { integrationsTable } from './integrations/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { ssoProvidersTable } from './sso_providers/schema';
import { messageMetadataTable } from './streaming/schema';
import { toneOfVoiceTable, exampleMessagesTable } from './tone_of_voice/schema';
import { vendorsTable } from './vendors/schema';
import {
  websitePageEmbeddings256Table,
  websitePageEmbeddings512Table,
  websitePageEmbeddings1024Table,
  websitePageEmbeddings1536Table,
  websitePageEmbeddings2048Table,
  websitePageEmbeddings2560Table,
  websitePageEmbeddings4096Table,
} from './website_page_embeddings/schema';
import { websitesTable, websitePagesTable } from './websites/schema';
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
  exampleMessages: exampleMessagesTable,
  integrations: integrationsTable,
  messageMetadata: messageMetadataTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  products: productsTable,
  ssoProviders: ssoProvidersTable,
  toneOfVoice: toneOfVoiceTable,
  vendors: vendorsTable,
  websitePageEmbeddings256: websitePageEmbeddings256Table,
  websitePageEmbeddings512: websitePageEmbeddings512Table,
  websitePageEmbeddings1024: websitePageEmbeddings1024Table,
  websitePageEmbeddings1536: websitePageEmbeddings1536Table,
  websitePageEmbeddings2048: websitePageEmbeddings2048Table,
  websitePageEmbeddings2560: websitePageEmbeddings2560Table,
  websitePageEmbeddings4096: websitePageEmbeddings4096Table,
  websitePages: websitePagesTable,
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
