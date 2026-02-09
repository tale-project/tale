/**
 * Action Output Schemas Registry
 *
 * Defines the output schema for each action type and operation.
 * These schemas are used to validate variable references in workflow definitions.
 *
 * IMPORTANT: This module uses Convex generated types (Doc<T>) as type constraints
 * to ensure field definitions match the database schema. The `_createDocSchema` and
 * `createDocFields` functions require field names to be valid keys of the Doc type.
 */

import type { Doc, TableNames } from '../../../../_generated/dataModel';
import type {
  OutputSchema,
  ActionOutputSchemaRegistry,
  FieldSchema,
} from './types';

// =============================================================================
// TYPE-SAFE SCHEMA BUILDERS (Constrained by Convex Types)
// =============================================================================

/**
 * Helper to create a field schema that references a Convex table ID.
 * The table parameter is type-checked against TableNames.
 */
const idField = (table: TableNames): FieldSchema => ({
  type: 'id',
  table,
  description: `ID reference to ${table} table`,
});

/**
 * Type-safe field definition for a Convex document.
 * The keys are constrained to be valid fields of Doc<T>.
 */
type TypeSafeDocFields<T extends TableNames> = {
  [K in keyof Doc<T>]?: FieldSchema;
};

/**
 * Creates a type-safe field schema for a Convex document table.
 * TypeScript will error if you try to define a field that doesn't exist on Doc<T>.
 *
 * @example
 * // This will type-check that 'name', 'email' are valid fields on Doc<'customers'>
 * const customerFields = createDocFields('customers', {
 *   _id: idField('customers'),
 *   name: { type: 'string', optional: true },
 *   email: { type: 'string', optional: true },
 *   invalidField: { type: 'string' }, // TS Error: 'invalidField' doesn't exist on Doc<'customers'>
 * });
 */
function createDocFields<T extends TableNames>(
  table: T,
  fields: TypeSafeDocFields<T>,
): Record<string, FieldSchema> {
  // Always include system fields
  const result: Record<string, FieldSchema> = {
    _id: idField(table),
    _creationTime: {
      type: 'number',
      description: 'Document creation timestamp',
    },
  };

  // Add user-defined fields (already type-checked by TypeScript)
  for (const [key, schema] of Object.entries(fields)) {
    if (schema) {
      result[key] = schema;
    }
  }

  return result;
}

/**
 * Creates an OutputSchema for a Convex document type.
 * Fields are type-checked against the actual Doc<T> type.
 */
function _createDocSchema<T extends TableNames>(
  table: T,
  description: string,
  fields: TypeSafeDocFields<T>,
  options?: { nullable?: boolean; isArray?: boolean },
): OutputSchema {
  return {
    description,
    nullable: options?.nullable,
    isArray: options?.isArray,
    fields: createDocFields(table, fields),
    items: options?.isArray
      ? { type: 'object', fields: createDocFields(table, fields) }
      : undefined,
  };
}

// =============================================================================
// COMMON SCHEMA HELPERS
// =============================================================================

const paginatedResultSchema = (itemDescription: string): OutputSchema => ({
  description: `Paginated ${itemDescription} result`,
  fields: {
    items: {
      type: 'array',
      description: `Array of ${itemDescription}`,
      items: { type: 'object' },
    },
    isDone: {
      type: 'boolean',
      description: 'Whether all results have been fetched',
    },
    continueCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for next page',
    },
    count: { type: 'number', description: 'Number of items in this page' },
  },
});

// =============================================================================
// PRODUCT ACTION SCHEMAS (Constrained by Doc<'products'>)
// =============================================================================

/**
 * Product fields - type-checked against Doc<'products'> schema.
 * TypeScript will error if a field name doesn't exist on the products table.
 */
const productFields = createDocFields('products', {
  _id: idField('products'),
  _creationTime: { type: 'number', description: 'Creation timestamp' },
  organizationId: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string', optional: true },
  imageUrl: { type: 'string', optional: true },
  stock: { type: 'number', optional: true },
  price: { type: 'number', optional: true },
  currency: { type: 'string', optional: true },
  category: { type: 'string', optional: true },
  tags: { type: 'array', items: { type: 'string' }, optional: true },
  status: { type: 'string', optional: true },
  externalId: { type: 'string', optional: true },
  translations: {
    type: 'array',
    optional: true,
    description: 'Product translations',
  },
  lastUpdated: { type: 'number', optional: true },
  metadata: { type: 'any', optional: true },
});

const productSchemas: Record<string, OutputSchema> = {
  create: {
    description: 'Created product document',
    fields: productFields,
  },
  get_by_id: {
    description: 'Product document or null',
    nullable: true,
    fields: productFields,
  },
  query: paginatedResultSchema('products'),
  filter: {
    description: 'Array of filtered products',
    isArray: true,
    items: { type: 'object', fields: productFields },
  },
  hydrate_fields: {
    description: 'Array of items with hydrated product fields',
    isArray: true,
    items: {
      type: 'any',
      description: 'Original item with added product fields',
    },
  },
};

// =============================================================================
// APPROVAL ACTION SCHEMAS (Constrained by Doc<'approvals'>)
// =============================================================================

/**
 * Approval fields - type-checked against Doc<'approvals'> schema.
 */
const approvalFields = createDocFields('approvals', {
  _id: idField('approvals'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  wfExecutionId: { type: 'id', table: 'wfExecutions', optional: true },
  stepSlug: { type: 'string', optional: true },
  status: { type: 'string', description: 'pending | approved | rejected' },
  approvedBy: { type: 'string', optional: true },
  reviewedAt: { type: 'number', optional: true },
  resourceType: { type: 'string' },
  resourceId: { type: 'string' },
  priority: { type: 'string', description: 'low | medium | high | urgent' },
  dueDate: { type: 'number', optional: true },
  metadata: { type: 'any', optional: true },
});

const approvalSchemas: Record<string, OutputSchema> = {
  create_approval: {
    description: 'Created approval document or null',
    nullable: true,
    fields: approvalFields,
  },
};

// =============================================================================
// CUSTOMER ACTION SCHEMAS (Constrained by Doc<'customers'>)
// =============================================================================

/**
 * Customer fields - type-checked against Doc<'customers'> schema.
 */
const customerFields = createDocFields('customers', {
  _id: idField('customers'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  name: { type: 'string', optional: true },
  email: { type: 'string', optional: true },
  externalId: { type: 'string', optional: true },
  status: { type: 'string', optional: true },
  source: { type: 'string' },
  locale: { type: 'string', optional: true },
  address: { type: 'object', optional: true, description: 'Customer address' },
  metadata: { type: 'any', optional: true },
});

const customerSchemas: Record<string, OutputSchema> = {
  create: {
    description: 'Created customer document',
    fields: customerFields,
  },
  filter: {
    description: 'Array of filtered customers',
    isArray: true,
    items: { type: 'object', fields: customerFields },
  },
  query: paginatedResultSchema('customers'),
  update: {
    description: 'Updated customer document',
    fields: customerFields,
  },
};

// =============================================================================
// WORKFLOW PROCESSING RECORDS ACTION SCHEMAS (Constrained by Doc<'workflowProcessingRecords'>)
// =============================================================================

/**
 * Workflow processing record fields - type-checked against Doc<'workflowProcessingRecords'> schema.
 */
const processingRecordFields = createDocFields('workflowProcessingRecords', {
  _id: idField('workflowProcessingRecords'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  tableName: { type: 'string' },
  recordId: { type: 'string' },
  wfDefinitionId: { type: 'string' },
  recordCreationTime: { type: 'number' },
  processedAt: { type: 'number' },
  status: {
    type: 'string',
    optional: true,
    description: 'in_progress | completed',
  },
  metadata: { type: 'any', optional: true },
});

const workflowProcessingRecordsSchemas: Record<string, OutputSchema> = {
  find_unprocessed: {
    // Dynamic output - returns full document from the specified table
    // Can be customers, products, documents, websitePages, etc.
    // We can't statically validate fields since it depends on tableName parameter
    description: 'Full unprocessed record from the specified table, or null',
    nullable: true,
    // No fields = dynamic output, allow any field access
  },
  record_processed: {
    description: 'Processing record or null',
    nullable: true,
    fields: processingRecordFields,
  },
};

// =============================================================================
// SET VARIABLES ACTION SCHEMA
// =============================================================================

const setVariablesSchemas: Record<string, OutputSchema> = {
  // set_variables returns the variables object directly
  default: {
    description: 'Set variables result containing the updated variables',
    fields: {
      variables: { type: 'object', description: 'Updated workflow variables' },
    },
  },
};

// =============================================================================
// CONVERSATION ACTION SCHEMAS (Constrained by Doc<'conversations'>)
// =============================================================================

/**
 * Conversation fields - type-checked against Doc<'conversations'> schema.
 */
const conversationFields = createDocFields('conversations', {
  _id: idField('conversations'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  customerId: { type: 'id', table: 'customers', optional: true },
  externalMessageId: { type: 'string', optional: true },
  subject: { type: 'string', optional: true },
  status: {
    type: 'string',
    optional: true,
    description: 'open | closed | spam | archived',
  },
  priority: { type: 'string', optional: true },
  type: { type: 'string', optional: true },
  channel: { type: 'string', optional: true },
  direction: {
    type: 'string',
    optional: true,
    description: 'inbound | outbound',
  },
  providerId: { type: 'id', table: 'emailProviders', optional: true },
  metadata: { type: 'any', optional: true },
});

const conversationSchemas: Record<string, OutputSchema> = {
  create: {
    description: 'Created conversation document',
    fields: conversationFields,
  },
  query_messages: paginatedResultSchema('messages'),
  update: {
    description: 'Updated conversation document',
    fields: conversationFields,
  },
};

// =============================================================================
// DOCUMENT ACTION SCHEMAS (Constrained by Doc<'documents'>)
// =============================================================================

/**
 * Document fields - type-checked against Doc<'documents'> schema.
 */
const documentFields = createDocFields('documents', {
  _id: idField('documents'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  title: { type: 'string', optional: true },
  content: { type: 'string', optional: true },
  fileId: { type: 'id', table: '_storage', optional: true },
  mimeType: { type: 'string', optional: true },
  extension: { type: 'string', optional: true },
  sourceProvider: { type: 'string', optional: true },
  externalItemId: { type: 'string', optional: true },
  metadata: { type: 'any', optional: true },
});

const documentSchemas: Record<string, OutputSchema> = {
  update: {
    description: 'Updated document',
    fields: documentFields,
  },
};

// =============================================================================
// INTEGRATION ACTION SCHEMAS
// =============================================================================

const integrationSchemas: Record<string, OutputSchema> = {
  // Integration actions are dynamic - output depends on the connector
  default: {
    description:
      'Integration result - structure depends on the connector and operation',
  },
};

// =============================================================================
// RAG ACTION SCHEMAS
// =============================================================================

const ragSchemas: Record<string, OutputSchema> = {
  upload_document: {
    description: 'RAG document upload result',
    fields: {
      success: { type: 'boolean', description: 'Whether the upload succeeded' },
      recordId: {
        type: 'string',
        description: 'Caller-level record identifier',
      },
      ragDocumentId: {
        type: 'string',
        optional: true,
        description: 'RAG service document ID',
      },
      chunksCreated: { type: 'number', optional: true },
      processingTimeMs: { type: 'number', optional: true },
      error: { type: 'string', optional: true },
      timestamp: { type: 'number', description: 'Upload timestamp' },
      executionTimeMs: { type: 'number', optional: true },
      documentType: { type: 'string', optional: true },
      queued: { type: 'boolean', optional: true },
      jobId: { type: 'string', optional: true },
    },
  },
  upload_text: {
    description: 'RAG text upload result',
    fields: {
      success: { type: 'boolean' },
      recordId: { type: 'string' },
      ragDocumentId: { type: 'string', optional: true },
      chunksCreated: { type: 'number', optional: true },
      processingTimeMs: { type: 'number', optional: true },
      error: { type: 'string', optional: true },
      timestamp: { type: 'number' },
      executionTimeMs: { type: 'number', optional: true },
      documentType: { type: 'string', optional: true },
      queued: { type: 'boolean', optional: true },
      jobId: { type: 'string', optional: true },
    },
  },
};

// =============================================================================
// IMAP ACTION SCHEMAS
// =============================================================================

const imapSchemas: Record<string, OutputSchema> = {
  search: {
    description: 'Array of email messages',
    isArray: true,
    items: {
      type: 'object',
      fields: {
        uid: { type: 'number' },
        messageId: { type: 'string' },
        from: { type: 'array', description: 'Array of {name?, address}' },
        to: { type: 'array', description: 'Array of {name?, address}' },
        cc: { type: 'array', optional: true },
        bcc: { type: 'array', optional: true },
        subject: { type: 'string' },
        date: { type: 'string' },
        text: { type: 'string', optional: true },
        html: { type: 'string', optional: true },
        attachments: { type: 'array', optional: true },
        flags: { type: 'array' },
        headers: { type: 'object', optional: true },
      },
    },
  },
};

// =============================================================================
// EMAIL PROVIDER ACTION SCHEMAS (Constrained by Doc<'emailProviders'>)
// =============================================================================

const emailProviderSchemas: Record<string, OutputSchema> = {
  get_default: {
    description:
      'Default email provider configuration (flattened, no oauth2Auth)',
    fields: {
      // Note: get_default returns a narrower shape than the full emailProviderFields:
      // - Excludes oauth2Auth entirely (sensitive data)
      // - passwordAuth narrowed to { user, passEncrypted } only
      _id: idField('emailProviders'),
      name: { type: 'string' },
      vendor: {
        type: 'string',
        description: 'gmail | outlook | smtp | resend | other',
      },
      authMethod: { type: 'string', description: 'password | oauth2' },
      imapConfig: { type: 'object', optional: true },
      smtpConfig: { type: 'object', optional: true },
      passwordAuth: {
        type: 'object',
        optional: true,
        fields: {
          user: { type: 'string' },
          passEncrypted: { type: 'string' },
        },
      },
      isDefault: { type: 'boolean' },
      status: { type: 'string', description: 'active | inactive | error' },
    },
  },
  get_imap_credentials: {
    description: 'IMAP credentials for the default email provider',
    fields: {
      providerId: idField('emailProviders'),
      credentials: {
        type: 'object',
        fields: {
          host: { type: 'string' },
          port: { type: 'number' },
          secure: { type: 'boolean' },
          username: { type: 'string' },
          passwordEncrypted: { type: 'string', optional: true },
          accessTokenEncrypted: { type: 'string', optional: true },
        },
      },
      authMethod: { type: 'string', description: 'password | oauth2' },
    },
  },
};

// =============================================================================
// TONE OF VOICE ACTION SCHEMAS (Constrained by Doc<'toneOfVoice'>)
// =============================================================================

/**
 * Tone of voice fields - type-checked against Doc<'toneOfVoice'> schema.
 */
const toneOfVoiceFields = createDocFields('toneOfVoice', {
  _id: idField('toneOfVoice'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  generatedTone: { type: 'string', optional: true },
  lastUpdated: { type: 'number' },
  metadata: { type: 'any', optional: true },
});

const toneOfVoiceSchemas: Record<string, OutputSchema> = {
  get_tone_of_voice: {
    description: 'Tone of voice configuration or null',
    nullable: true,
    fields: toneOfVoiceFields,
  },
};

// =============================================================================
// ONEDRIVE ACTION SCHEMAS
// =============================================================================

const onedriveSchemas: Record<string, OutputSchema> = {
  get_user_token: {
    description: 'Microsoft Graph token for user',
    fields: {
      token: { type: 'string' },
      needsRefresh: { type: 'boolean' },
      accountId: { type: 'string' },
      refreshToken: { type: 'string' },
      userId: { type: 'string' },
    },
  },
  refresh_token: {
    description: 'Refreshed access token',
    fields: {
      token: { type: 'string' },
    },
  },
  read_file: {
    description: 'File content from OneDrive',
    fields: {
      content: {
        type: 'any',
        description: 'File content (string or ArrayBuffer)',
      },
      mimeType: { type: 'string', optional: true },
      size: { type: 'number', optional: true },
    },
  },
  list_folder_contents: {
    description: 'Array of files in OneDrive folder',
    isArray: true,
    items: {
      type: 'object',
      fields: {
        id: { type: 'string' },
        name: { type: 'string' },
        size: { type: 'number' },
        mimeType: { type: 'string', optional: true },
        lastModified: { type: 'number', optional: true },
      },
    },
  },
  sync_folder_files: {
    description: 'Sync operation result',
    fields: {
      created: { type: 'number' },
      updated: { type: 'number' },
      skipped: { type: 'number' },
      errorsCount: { type: 'number' },
    },
  },
  upload_to_storage: {
    description: 'Uploaded file info',
    fields: {
      fileId: { type: 'id', table: '_storage' },
      documentId: { type: 'id', table: 'documents', optional: true },
      storagePath: { type: 'string', optional: true },
    },
  },
  update_sync_config: {
    description: 'Updated sync config info',
    fields: {
      configId: idField('onedriveSyncConfigs'),
      status: { type: 'string', optional: true },
    },
  },
};

// =============================================================================
// CRAWLER ACTION SCHEMAS
// =============================================================================

const crawlerSchemas: Record<string, OutputSchema> = {
  discover_urls: {
    description: 'URL discovery result',
    fields: {
      success: { type: 'boolean' },
      domain: { type: 'string' },
      urls_discovered: { type: 'number' },
      urls: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            url: { type: 'string' },
            status: { type: 'string' },
            metadata: { type: 'object', optional: true },
          },
        },
      },
    },
  },
  fetch_urls: {
    description: 'URL fetch result with page content',
    fields: {
      success: { type: 'boolean' },
      urls_requested: { type: 'number' },
      urls_fetched: { type: 'number' },
      pages: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            url: { type: 'string' },
            title: { type: 'string', optional: true },
            content: { type: 'string' },
            word_count: { type: 'number' },
            metadata: { type: 'object', optional: true },
            structured_data: { type: 'object', optional: true },
          },
        },
      },
    },
  },
};

// =============================================================================
// WEBSITE ACTION SCHEMAS (Constrained by Doc<'websites'>)
// =============================================================================

/**
 * Website fields - type-checked against Doc<'websites'> schema.
 */
const websiteFields = createDocFields('websites', {
  _id: idField('websites'),
  _creationTime: { type: 'number' },
  organizationId: { type: 'string' },
  domain: { type: 'string' },
  title: { type: 'string', optional: true },
  description: { type: 'string', optional: true },
  scanInterval: { type: 'string' },
  lastScannedAt: { type: 'number', optional: true },
  status: {
    type: 'string',
    optional: true,
    description: 'active | inactive | error',
  },
  metadata: { type: 'any', optional: true },
});

const websiteSchemas: Record<string, OutputSchema> = {
  create: {
    description: 'Created website document or null',
    nullable: true,
    fields: websiteFields,
  },
  update: {
    description: 'Updated website document',
    fields: websiteFields,
  },
  get_by_domain: {
    description: 'Website document or null',
    nullable: true,
    fields: websiteFields,
  },
};

// =============================================================================
// WEBSITE PAGES ACTION SCHEMAS
// =============================================================================

const websitePagesSchemas: Record<string, OutputSchema> = {
  bulk_upsert: {
    description: 'Bulk upsert result',
    fields: {
      created: { type: 'number', description: 'Number of pages created' },
      updated: { type: 'number', description: 'Number of pages updated' },
      total: { type: 'number', description: 'Total pages processed' },
    },
  },
};

// =============================================================================
// WORKFLOW ACTION SCHEMAS
// =============================================================================

const workflowSchemas: Record<string, OutputSchema> = {
  upload_all_workflows: {
    description: 'Workflow upload result',
    fields: {
      success: { type: 'boolean' },
      uploaded: {
        type: 'number',
        optional: true,
        description: 'Number of workflows uploaded',
      },
      failed: {
        type: 'number',
        optional: true,
        description: 'Number of workflows failed',
      },
      errors: { type: 'array', optional: true, description: 'Error details' },
      executionTimeMs: {
        type: 'number',
        description: 'Execution time in milliseconds',
      },
    },
  },
};

// =============================================================================
// ACTION OUTPUT SCHEMA REGISTRY
// =============================================================================

/**
 * Registry of output schemas for all action types
 *
 * Complete list of supported actions:
 * - customer: Customer CRUD operations
 * - conversation: Conversation management
 * - product: Product operations and hydration
 * - document: Document management
 * - set_variables: Workflow variable operations
 * - rag: RAG document upload
 * - imap: IMAP email retrieval
 * - email_provider: Email provider configuration
 * - workflow_processing_records: Processing record tracking
 * - approval: Approval workflow operations
 * - tone_of_voice: Tone of voice configuration
 * - integration: Dynamic integration connectors
 * - onedrive: OneDrive file operations
 * - crawler: Website crawling
 * - website: Website management
 * - websitePages: Website page management
 * - workflow: Workflow utility operations
 */
export const actionOutputSchemaRegistry: ActionOutputSchemaRegistry = {
  product: productSchemas,
  approval: approvalSchemas,
  customer: customerSchemas,
  workflow_processing_records: workflowProcessingRecordsSchemas,
  set_variables: setVariablesSchemas,
  conversation: conversationSchemas,
  document: documentSchemas,
  integration: integrationSchemas,
  rag: ragSchemas,
  imap: imapSchemas,
  email_provider: emailProviderSchemas,
  tone_of_voice: toneOfVoiceSchemas,
  onedrive: onedriveSchemas,
  crawler: crawlerSchemas,
  website: websiteSchemas,
  websitePages: websitePagesSchemas,
  workflow: workflowSchemas,
};

/**
 * Get the output schema for a specific action type and operation
 */
export function getActionOutputSchema(
  actionType: string,
  operation?: string,
): OutputSchema | null {
  const actionSchemas = actionOutputSchemaRegistry[actionType];
  if (!actionSchemas) {
    return null;
  }

  // Try to find schema for specific operation
  if (operation && actionSchemas[operation]) {
    return actionSchemas[operation];
  }

  // Fall back to default schema if available
  if (actionSchemas['default']) {
    return actionSchemas['default'];
  }

  return null;
}
