const GITHUB_RAW_BASE = import.meta.env.DEV
  ? '/workflow-templates'
  : 'https://raw.githubusercontent.com/tale-project/tale/main/examples/workflows';

export interface WorkflowTemplate {
  path: string;
  title: string;
  description: string;
  integrationName: string;
}

export function getWorkflowTemplateUrl(path: string) {
  return `${GITHUB_RAW_BASE}/${path}.json`;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    path: 'gmail/email-sync',
    title: 'Email Sync (Gmail)',
    description:
      'Sync emails from Gmail into conversations with automatic thread grouping',
    integrationName: 'gmail',
  },
  {
    path: 'outlook/email-sync',
    title: 'Email Sync (Outlook)',
    description:
      'Sync emails from Outlook into conversations with automatic thread grouping',
    integrationName: 'outlook',
  },
  {
    path: 'shopify/sync-customers',
    title: 'Sync Customers (Shopify)',
    description: 'Synchronize customers from Shopify with pagination',
    integrationName: 'shopify',
  },
  {
    path: 'shopify/sync-products',
    title: 'Sync Products (Shopify)',
    description: 'Synchronize products from Shopify with pagination',
    integrationName: 'shopify',
  },
  {
    path: 'circuly/sync-customers',
    title: 'Sync Customers (Circuly)',
    description: 'Synchronize customers from Circuly with pagination',
    integrationName: 'circuly',
  },
  {
    path: 'circuly/sync-products',
    title: 'Sync Products (Circuly)',
    description: 'Synchronize products from Circuly with pagination',
    integrationName: 'circuly',
  },
  {
    path: 'circuly/sync-subscriptions',
    title: 'Sync Subscriptions (Circuly)',
    description: 'Synchronize subscriptions from Circuly to customer metadata',
    integrationName: 'circuly',
  },
  {
    path: 'onedrive/sync',
    title: 'OneDrive Sync',
    description: 'Sync files and folders from OneDrive',
    integrationName: 'onedrive',
  },
  {
    path: 'general/conversation-sync',
    title: 'Conversation Sync',
    description:
      'Sync messages from any integration into conversations with thread grouping',
    integrationName: '',
  },
  {
    path: 'general/conversation-auto-archive',
    title: 'Auto-Archive Conversations',
    description:
      'Automatically archive conversations that have been closed for over 30 days',
    integrationName: '',
  },
  {
    path: 'general/document-rag-sync',
    title: 'Document RAG Sync',
    description: 'Find unprocessed documents and upload them to RAG service',
    integrationName: '',
  },
];
