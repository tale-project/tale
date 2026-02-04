import { defineSchema } from 'convex/server';

import { approvalsTable } from './approvals/schema';
import { auditLogsTable } from './audit_logs/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { customersTable } from './customers/schema';
import { documentsTable } from './documents/schema';
import { emailProvidersTable } from './email_providers/schema';
import { integrationsTable } from './integrations/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { ssoProvidersTable } from './sso_providers/schema';
import { messageMetadataTable } from './streaming/schema';
import { toneOfVoiceTable, exampleMessagesTable } from './tone_of_voice/schema';
import { vendorsTable } from './vendors/schema';
import { websitesTable, websitePagesTable } from './websites/schema';
import {
  wfDefinitionsTable,
  wfExecutionsTable,
  wfStepAuditLogsTable,
  wfStepDefsTable,
  workflowProcessingRecordsTable,
} from './workflows/schema';

export default defineSchema({
  approvals: approvalsTable,
  auditLogs: auditLogsTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  customers: customersTable,
  documents: documentsTable,
  emailProviders: emailProvidersTable,
  exampleMessages: exampleMessagesTable,
  integrations: integrationsTable,
  messageMetadata: messageMetadataTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  products: productsTable,
  ssoProviders: ssoProvidersTable,
  toneOfVoice: toneOfVoiceTable,
  vendors: vendorsTable,
  websitePages: websitePagesTable,
  websites: websitesTable,
  wfDefinitions: wfDefinitionsTable,
  wfExecutions: wfExecutionsTable,
  wfStepAuditLogs: wfStepAuditLogsTable,
  wfStepDefs: wfStepDefsTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
});
