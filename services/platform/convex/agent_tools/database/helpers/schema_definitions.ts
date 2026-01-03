/**
 * Static schema definitions for tables supported by workflow_processing_records
 *
 * These definitions tell the AI what fields are available for filterExpressions.
 * Derived from schema.ts and get_table_indexes.ts.
 */

import type { TableSchemaDefinition } from './types';

/**
 * Schema definitions for all supported tables
 */
export const TABLE_SCHEMAS: Record<string, TableSchemaDefinition> = {
  conversations: {
    tableName: 'conversations',
    description:
      'Customer conversations from various channels (email, chat, etc.)',
    filterableFields: [
      {
        field: 'status',
        type: 'enum',
        values: ['open', 'closed', 'archived', 'spam'],
        note: 'Conversation status. Use "closed" with daysAgo(metadata.resolved_at) for stale conversations.',
      },
      {
        field: 'priority',
        type: 'enum',
        values: ['low', 'medium', 'high', 'urgent'],
      },
      {
        field: 'type',
        type: 'string',
        note: 'Conversation type (e.g., "product_recommendation", "churn_survey", "service_request", "general")',
      },
      {
        field: 'channel',
        type: 'enum',
        values: ['email', 'chat', 'phone', 'sms', 'social'],
      },
      {
        field: 'direction',
        type: 'enum',
        values: ['inbound', 'outbound'],
      },
      {
        field: 'metadata.resolved_at',
        type: 'datetime',
        note: 'When the conversation was resolved/closed. Use with daysAgo() transform.',
      },
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the conversation was created. Use with daysAgo() transform.',
      },
    ],
    examples: [
      'status == "open"',
      'status == "closed"',
      'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      'status == "open" && priority == "high"',
      'channel == "email" && direction == "inbound"',
      'type == "product_recommendation"',
    ],
  },

  customers: {
    tableName: 'customers',
    description: 'Customer profiles with contact info and status',
    filterableFields: [
      {
        field: 'status',
        type: 'enum',
        values: ['active', 'churned', 'potential'],
      },
      {
        field: 'source',
        type: 'string',
        note: 'Data source (e.g., "manual_import", "file_upload", "circuly", "shopify")',
      },
      {
        field: 'locale',
        type: 'string',
        note: 'Customer locale/language (e.g., "en", "de", "fr")',
      },
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the customer was created. Use with daysAgo() transform.',
      },
    ],
    examples: [
      'status == "active"',
      'status == "churned"',
      'status == "potential"',
      'source == "shopify"',
      'daysAgo(_creationTime) < 30',
    ],
  },

  products: {
    tableName: 'products',
    description: 'Product catalog with pricing and inventory',
    filterableFields: [
      {
        field: 'status',
        type: 'enum',
        values: ['active', 'inactive', 'draft', 'archived'],
      },
      {
        field: 'category',
        type: 'string',
        note: 'Product category',
      },
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the product was created. Use with daysAgo() transform.',
      },
    ],
    examples: [
      'status == "active"',
      'status == "draft"',
      'category == "electronics"',
    ],
  },

  approvals: {
    tableName: 'approvals',
    description: 'Approval records for workflow actions requiring human review',
    filterableFields: [
      {
        field: 'status',
        type: 'enum',
        values: ['pending', 'approved', 'rejected'],
      },
      {
        field: 'resourceType',
        type: 'string',
        note: 'Type of resource being approved (e.g., "product_recommendation", "conversations", "email")',
      },
      {
        field: 'priority',
        type: 'enum',
        values: ['low', 'medium', 'high', 'urgent'],
      },
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the approval was created. Use with daysAgo() transform.',
      },
    ],
    examples: [
      'status == "pending"',
      'status == "approved"',
      'status == "approved" && resourceType == "product_recommendation"',
      'status == "pending" && priority == "urgent"',
      'daysAgo(_creationTime) > 7 && status == "pending"',
    ],
  },

  documents: {
    tableName: 'documents',
    description: 'Uploaded documents and files',
    filterableFields: [
      {
        field: 'sourceProvider',
        type: 'string',
        note: 'Source of the document (e.g., "onedrive", "upload")',
      },
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the document was created. Use with daysAgo() transform.',
      },
    ],
    examples: ['sourceProvider == "onedrive"', 'daysAgo(_creationTime) < 7'],
  },

  websitePages: {
    tableName: 'websitePages',
    description: 'Crawled website pages for RAG indexing',
    filterableFields: [
      {
        field: '_creationTime',
        type: 'datetime',
        note: 'When the page was crawled. Use with daysAgo() transform.',
      },
    ],
    examples: ['daysAgo(_creationTime) > 30'],
  },

  onedriveSyncConfigs: {
    tableName: 'onedriveSyncConfigs',
    description: 'OneDrive sync configuration records',
    filterableFields: [
      {
        field: 'status',
        type: 'string',
        note: 'Sync status',
      },
      {
        field: '_creationTime',
        type: 'datetime',
      },
    ],
    examples: ['status == "active"'],
  },

  exampleMessages: {
    tableName: 'exampleMessages',
    description: 'Example messages for training and testing',
    filterableFields: [
      {
        field: '_creationTime',
        type: 'datetime',
      },
    ],
    examples: [],
  },
};

/**
 * Get list of all supported tables
 */
export function getSupportedTables(): Array<{
  name: string;
  description: string;
}> {
  return Object.values(TABLE_SCHEMAS).map((schema) => ({
    name: schema.tableName,
    description: schema.description,
  }));
}

/**
 * Get schema for a specific table
 */
export function getTableSchema(
  tableName: string,
): TableSchemaDefinition | null {
  return TABLE_SCHEMAS[tableName] || null;
}
