import { defineSchema } from 'convex/server';

import { customersTable } from './customers/schema';
import { productsTable } from './products/schema';
import { vendorsTable } from './vendors/schema';
import { documentsTable } from './documents/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { integrationsTable } from './integrations/schema';
import { emailProvidersTable } from './email_providers/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import {
  wfDefinitionsTable,
  wfStepDefsTable,
  wfExecutionsTable,
  workflowProcessingRecordsTable,
} from './workflows/schema';
import { approvalsTable } from './approvals/schema';
import {
  toneOfVoiceTable,
  exampleMessagesTable,
} from './tone_of_voice/schema';
import {
  websitesTable,
  websitePagesTable,
} from './websites/schema';
import { messageMetadataTable } from './streaming/schema';

export default defineSchema({
  documents: documentsTable,
  products: productsTable,
  customers: customersTable,
  vendors: vendorsTable,
  integrations: integrationsTable,
  emailProviders: emailProvidersTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  conversations: conversationsTable,
  conversationMessages: conversationMessagesTable,
  wfDefinitions: wfDefinitionsTable,
  wfStepDefs: wfStepDefsTable,
  wfExecutions: wfExecutionsTable,
  approvals: approvalsTable,
  toneOfVoice: toneOfVoiceTable,
  exampleMessages: exampleMessagesTable,
  websites: websitesTable,
  websitePages: websitePagesTable,
  workflowProcessingRecords: workflowProcessingRecordsTable,
  messageMetadata: messageMetadataTable,
});
