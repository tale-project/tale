import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { stepConfigValidator } from './workflow/types/nodes';

// Minimal core schema with flexible metadata using v.any().
// Core entities: documents, products, customers, integrations, tasks, chats.
// Organizations and members are managed by Better Auth's organization plugin.
// All business-specific features (subscriptions, churn survey, recommendations, messaging, etc.)
// should be expressed in the metadata fields or modeled at the no-code layer.

export default defineSchema({
  // Documents (generic content container; use metadata for structure)
  documents: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()), // MIME type of the file (e.g., 'application/pdf', 'image/png')
    extension: v.optional(v.string()), // File extension without dot, lowercase (e.g., 'pdf', 'pptx', 'docx')
    // New explicit source fields
    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
    externalItemId: v.optional(v.string()),
    // RAG indexing status - tracks status of document in RAG service
    ragInfo: v.optional(
      v.object({
        status: v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
        ),
        jobId: v.optional(v.string()),
        indexedAt: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_sourceProvider', [
      'organizationId',
      'sourceProvider',
    ])
    .index('by_organizationId_and_externalItemId', [
      'organizationId',
      'externalItemId',
    ])
    .index('by_organizationId_and_extension', ['organizationId', 'extension'])
    .index('by_organizationId_and_title', ['organizationId', 'title']),

  // Products
  products: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    name: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    stock: v.optional(v.number()),
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('inactive'),
        v.literal('draft'),
        v.literal('archived'),
      ),
    ),
    translations: v.optional(
      v.array(
        v.object({
          language: v.string(),
          name: v.optional(v.string()),
          description: v.optional(v.string()),
          category: v.optional(v.string()),
          tags: v.optional(v.array(v.string())),
          metadata: v.optional(v.any()),
          createdAt: v.optional(v.number()),
          lastUpdated: v.number(),
        }),
      ),
    ),
    lastUpdated: v.optional(v.number()),
    externalId: v.optional(v.union(v.string(), v.number())),
    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_category', ['organizationId', 'category'])
    .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
    // Compound indexes for efficient sorted pagination
    .index('by_org_status_lastUpdated', ['organizationId', 'status', 'lastUpdated'])
    .index('by_org_lastUpdated', ['organizationId', 'lastUpdated'])
    .searchIndex('search_products', {
      searchField: 'name',
      filterFields: ['organizationId', 'status', 'category'],
    }),

  // Customers
  customers: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    externalId: v.optional(v.union(v.string(), v.number())),

    // Customer status: active, churned, potential
    status: v.optional(
      v.union(
        v.literal('active'),
        v.literal('churned'),
        v.literal('potential'),
      ),
    ),

    // Data source: shopify, circuly, manual, import, etc.
    source: v.union(
      v.literal('manual_import'),
      v.literal('file_upload'),
      v.literal('circuly'),
    ),

    // Customer locale/language preference
    locale: v.optional(v.string()),

    // Customer address information
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        postalCode: v.optional(v.string()),
      }),
    ),

    // Additional flexible metadata
    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_email', ['organizationId', 'email'])
    .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_source', ['organizationId', 'source'])
    .index('by_organizationId_and_locale', ['organizationId', 'locale'])
    .searchIndex('search_customers', {
      searchField: 'name',
      filterFields: ['organizationId', 'status'],
    }),

  // Vendors
  vendors: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    externalId: v.optional(v.union(v.string(), v.number())),

    // Data source: manual_import, file_upload, circuly
    source: v.union(
      v.literal('manual_import'),
      v.literal('file_upload'),
      v.literal('circuly'),
    ),

    // Vendor locale/language preference
    locale: v.optional(v.string()),

    // Vendor address information
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        postalCode: v.optional(v.string()),
      }),
    ),

    // Vendor tags and segmentation
    tags: v.optional(v.array(v.string())),

    // Additional flexible metadata
    metadata: v.optional(v.any()),

    // Notes and comments
    notes: v.optional(v.string()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_email', ['organizationId', 'email'])
    .index('by_organizationId_and_externalId', ['organizationId', 'externalId'])
    .index('by_organizationId_and_source', ['organizationId', 'source'])
    .index('by_organizationId_and_locale', ['organizationId', 'locale']),

  // Integrations (Custom Integrations)
  // All integrations are "custom integrations" - they store both credentials and connector code
  integrations: defineTable({
    organizationId: v.string(), // Better Auth organization ID

    // Integration identity
    name: v.string(), // Unique identifier/type key (e.g., 'shopify', 'circuly', 'my_erp')
    title: v.string(), // Display name (e.g., 'Shopify', 'My Shopify Store')
    description: v.optional(v.string()),

    // Integration type (rest_api or sql)
    type: v.optional(
      v.union(v.literal('rest_api'), v.literal('sql')),
    ), // Default: rest_api for backward compatibility

    // Connection status
    status: v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('error'),
      v.literal('testing'),
    ),
    isActive: v.boolean(),

    // Authentication (structured, not generic metadata)
    authMethod: v.union(
      v.literal('api_key'),
      v.literal('bearer_token'),
      v.literal('basic_auth'),
      v.literal('oauth2'),
    ),

    // Auth credentials (encrypted)
    apiKeyAuth: v.optional(
      v.object({
        keyEncrypted: v.string(),
        keyPrefix: v.optional(v.string()), // e.g., "shpat_" for Shopify
      }),
    ),

    basicAuth: v.optional(
      v.object({
        username: v.string(),
        passwordEncrypted: v.string(),
      }),
    ),

    oauth2Auth: v.optional(
      v.object({
        accessTokenEncrypted: v.string(),
        refreshTokenEncrypted: v.optional(v.string()),
        tokenExpiry: v.optional(v.number()),
        scopes: v.optional(v.array(v.string())),
      }),
    ),

    // Provider-specific connection config
    connectionConfig: v.optional(
      v.object({
        // Shopify
        domain: v.optional(v.string()), // mystore.myshopify.com
        apiVersion: v.optional(v.string()), // 2024-01

        // Circuly
        apiEndpoint: v.optional(v.string()), // https://api.circuly.io/api/2025-01

        // Generic
        timeout: v.optional(v.number()),
        rateLimit: v.optional(v.number()),
      }),
    ),

    // Sync status and health
    lastSyncedAt: v.optional(v.number()),
    lastTestedAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastErrorAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),

    // Sync statistics
    syncStats: v.optional(
      v.object({
        totalRecords: v.optional(v.number()),
        lastSyncCount: v.optional(v.number()),
        failedSyncCount: v.optional(v.number()),
      }),
    ),

    // Feature flags and capabilities
    capabilities: v.optional(
      v.object({
        canSync: v.optional(v.boolean()),
        canPush: v.optional(v.boolean()),
        canWebhook: v.optional(v.boolean()),
        syncFrequency: v.optional(v.string()), // 'realtime', 'hourly', 'daily'
      }),
    ),

    // Connector configuration (for executing operations)
    // Contains the JavaScript code and operation definitions
    // Used when type = 'rest_api'
    connector: v.optional(
      v.object({
        // The connector code (JavaScript for QuickJS sandbox)
        code: v.string(),

        // Version number for tracking changes
        version: v.number(),

        // Declared operations
        operations: v.array(
          v.object({
            name: v.string(), // e.g., 'list_products', 'get_customer'
            title: v.optional(v.string()),
            description: v.optional(v.string()),
            parametersSchema: v.optional(v.any()), // JSON Schema for parameters
          }),
        ),

        // Secret bindings - maps to credentials from this integration
        // e.g., ['domain', 'accessToken'] maps to connectionConfig/credentials
        secretBindings: v.array(v.string()),

        // Security: URL allowlist for HTTP calls
        allowedHosts: v.optional(v.array(v.string())), // e.g., ['myshopify.com']

        // Execution limits
        timeoutMs: v.optional(v.number()), // Default: 30000
      }),
    ),

    // SQL-specific configuration (used when type = 'sql')
    sqlConnectionConfig: v.optional(
      v.object({
        engine: v.union(
          v.literal('mssql'),
          v.literal('postgres'),
          v.literal('mysql'),
        ),
        server: v.string(),
        port: v.optional(v.number()),
        database: v.string(),
        readOnly: v.optional(v.boolean()), // Default: true
        options: v.optional(
          v.object({
            encrypt: v.optional(v.boolean()),
            trustServerCertificate: v.optional(v.boolean()),
            connectionTimeout: v.optional(v.number()),
            requestTimeout: v.optional(v.number()),
          }),
        ),
        security: v.optional(
          v.object({
            maxResultRows: v.optional(v.number()), // Default: 10000
            queryTimeoutMs: v.optional(v.number()), // Default: 30000
            maxConnectionPoolSize: v.optional(v.number()), // Default: 5
          }),
        ),
      }),
    ),

    // SQL operations (used when type = 'sql')
    sqlOperations: v.optional(
      v.array(
        v.object({
          name: v.string(), // e.g., 'get_reservations', 'get_guest_profile'
          title: v.optional(v.string()),
          description: v.optional(v.string()),
          query: v.string(), // SQL query with native placeholders
          parametersSchema: v.optional(v.any()), // JSON Schema for parameters
          operationType: v.optional(v.union(v.literal('read'), v.literal('write'))), // Operation type for approval workflow
          requiresApproval: v.optional(v.boolean()), // Whether operation requires user approval
        }),
      ),
    ),

    // Only truly unstructured data here
    metadata: v.optional(v.any()), // For future extensibility
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_name', ['organizationId', 'name'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_status', ['status']),

  // Email Providers
  emailProviders: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    name: v.string(),
    vendor: v.union(
      v.literal('gmail'),
      v.literal('outlook'),
      v.literal('smtp'),
      v.literal('resend'),
      v.literal('other'),
    ),
    authMethod: v.union(v.literal('password'), v.literal('oauth2')),

    // Send method: 'smtp' uses SMTP protocol, 'api' uses provider's REST API (Gmail API / Microsoft Graph)
    sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),

    // Auth configurations (encrypted)
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        passEncrypted: v.string(), // encrypted password
      }),
    ),

    oauth2Auth: v.optional(
      v.object({
        provider: v.string(), // 'gmail' | 'microsoft'
        clientId: v.string(),
        clientSecretEncrypted: v.string(), // encrypted secret
        accessTokenEncrypted: v.optional(v.string()),
        refreshTokenEncrypted: v.optional(v.string()),
        tokenExpiry: v.optional(v.number()),
        tokenUrl: v.optional(v.string()), // Tenant-specific token URL for Microsoft
      }),
    ),

    // SMTP configuration
    smtpConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),

    // IMAP configuration
    imapConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),

    // Status and metadata
    isActive: v.optional(v.boolean()), // Deprecated, keeping for backwards compatibility
    isDefault: v.boolean(),
    status: v.optional(
      v.union(v.literal('active'), v.literal('error'), v.literal('testing')),
    ),
    lastTestedAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),

    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_vendor', ['organizationId', 'vendor'])
    .index('by_organizationId_and_isDefault', ['organizationId', 'isDefault'])
    .index('by_organizationId_and_status', ['organizationId', 'status']),

  // OneDrive Sync Configurations
  onedriveSyncConfigs: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    userId: v.string(), // Better Auth user ID (whose credentials to use for sync)
    itemType: v.union(v.literal('file'), v.literal('folder')),
    itemId: v.string(), // OneDrive item ID
    itemName: v.string(), // File or folder name
    itemPath: v.optional(v.string()), // Full path in OneDrive
    targetBucket: v.string(), // Storage bucket name
    storagePrefix: v.optional(v.string()), // Prefix for organized storage
    status: v.union(
      v.literal('active'),
      v.literal('inactive'),
      v.literal('error'),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_itemId', ['organizationId', 'itemId'])
    .index('by_itemId', ['itemId'])
    .index('by_userId', ['userId']),

  // Conversations (hierarchical via parentId and rootId; messages as child conversations)
  conversations: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    customerId: v.optional(v.id('customers')),
    externalMessageId: v.optional(v.string()), // External message ID that created this conversation (e.g., email messageId)
    subject: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('open'),
        v.literal('closed'),
        v.literal('spam'),
        v.literal('archived'),
      ),
    ),
    priority: v.optional(v.string()), // 'low' | 'medium' | 'high' | 'urgent'
    type: v.optional(v.string()), // 'product_recommendation' | 'churn_survey' | 'service_request' | 'general' | 'spam' | etc.
    channel: v.optional(v.string()), // 'email' | 'chat' | 'phone' | 'sms' | etc.
    direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))), // 'inbound' | 'outbound'
    providerId: v.optional(v.id('emailProviders')), // Email provider ID for this conversation

    // Denormalized field for efficient sorting by last message time
    // Updated when messages are added to the conversation
    lastMessageAt: v.optional(v.number()),

    metadata: v.optional(v.any()), // Additional flexible data (to/from, timestamps, etc.)
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_priority', ['organizationId', 'priority'])
    .index('by_organizationId_and_customerId', ['organizationId', 'customerId'])
    .index('by_organizationId_and_direction', ['organizationId', 'direction'])
    .index('by_organizationId_and_channel', ['organizationId', 'channel'])
    .index('by_organizationId_and_type', ['organizationId', 'type'])
    .index('by_organizationId_and_externalMessageId', [
      'organizationId',
      'externalMessageId',
    ])
    .index('by_organizationId_and_providerId', [
      'organizationId',
      'providerId',
    ])
    // Compound index for efficient sorted pagination by status and lastMessageAt
    .index('by_org_status_lastMessageAt', [
      'organizationId',
      'status',
      'lastMessageAt',
    ]),

  // Conversation Messages (one row per message in a conversation)
  conversationMessages: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    conversationId: v.id('conversations'),
    providerId: v.optional(v.id('emailProviders')), // Email provider ID (copied from parent conversation)
    channel: v.string(),
    direction: v.union(v.literal('inbound'), v.literal('outbound')),
    externalMessageId: v.optional(v.string()),
    deliveryState: v.union(
      v.literal('queued'),
      v.literal('sent'),
      v.literal('delivered'),
      v.literal('failed'),
    ),
    retryCount: v.optional(v.number()), // Tracks retry attempts for failed sends
    content: v.string(),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  })
    .index('by_conversationId_and_deliveredAt', [
      'conversationId',
      'deliveredAt',
    ])
    .index('by_organizationId_and_deliveredAt', [
      'organizationId',
      'deliveredAt',
    ])
    .index('by_organizationId_and_externalMessageId', [
      'organizationId',
      'externalMessageId',
    ])
    .index('by_organizationId_and_providerId', ['organizationId', 'providerId'])
    .index('by_org_channel_direction_deliveredAt', [
      'organizationId',
      'channel',
      'direction',
      'deliveredAt',
    ])
    .index('by_org_deliveryState_deliveredAt', [
      'organizationId',
      'deliveryState',
      'deliveredAt',
    ])
    .index('by_org_channel_direction_deliveryState_deliveredAt', [
      'organizationId',
      'channel',
      'direction',
      'deliveryState',
      'deliveredAt',
    ])
    .index('by_org_channel_direction_deliveryState_providerId_deliveredAt', [
      'organizationId',
      'channel',
      'direction',
      'deliveryState',
      'providerId',
      'deliveredAt',
    ]),

  // Workflows (user-defined workflow templates)
  // Version Management: Draft (editable) → Active (immutable) → Archived (historical)
  // Note: Stable workflow identifier is derived from name using snakeCase(name)
  wfDefinitions: defineTable({
    organizationId: v.string(), // Better Auth organization ID

    // Version information
    version: v.string(), // e.g., "v1", "v2", "v3"
    versionNumber: v.number(), // 1, 2, 3... (for sorting and comparison)

    // Version status
    status: v.string(), // 'draft' | 'active' | 'archived'

    // Workflow type - distinguishes between different workflow categories
    // Currently we only support predefined workflows.
    workflowType: v.literal('predefined'),

    // Workflow content (draft is mutable, active/archived are immutable)
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),

    // Workflow-level configuration
    config: v.optional(
      v.object({
        timeout: v.optional(v.number()),
        retryPolicy: v.optional(
          v.object({
            maxRetries: v.number(),
            backoffMs: v.number(),
          }),
        ),
        variables: v.optional(v.record(v.string(), v.any())), // default variables
        secrets: v.optional(
          v.record(
            v.string(),
            v.object({
              kind: v.literal('inlineEncrypted'),
              cipherText: v.string(),
              keyId: v.optional(v.string()),
            }),
          ),
        ), // encrypted secrets
      }),
    ),

    // Version tracking
    rootVersionId: v.optional(v.id('wfDefinitions')), // Root version for this workflow family
    parentVersionId: v.optional(v.id('wfDefinitions')), // Based on which version
    publishedAt: v.optional(v.number()), // When this version was published
    publishedBy: v.optional(v.string()), // Who published this version
    changeLog: v.optional(v.string()), // Change description

    // Optional AI planning metadata (historically used for dynamic orchestration workflows).
    // Kept for forward compatibility and advanced AI-driven workflow configuration.
    userRequirement: v.optional(
      v.object({
        goal: v.string(),
        context: v.optional(v.string()),
        constraints: v.optional(v.array(v.string())),
        expectedOutcome: v.optional(v.string()),
      }),
    ),

    availableAgentTypes: v.optional(v.array(v.string())),

    globalConfig: v.optional(v.any()),

    plannerConfig: v.optional(
      v.object({
        model: v.optional(v.string()),
        temperature: v.optional(v.number()),
        maxSteps: v.optional(v.number()),
      }),
    ),

    metadata: v.optional(v.any()),
  })
    .index('by_org', ['organizationId'])
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_status', ['status'])
    .index('by_org_and_name', ['organizationId', 'name'])
    .index('by_org_name_version', ['organizationId', 'name', 'versionNumber'])
    .index('by_org_name_status', ['organizationId', 'name', 'status'])
    .index('by_rootVersionId', ['rootVersionId']),

  // WorkflowSteps (user-defined step definitions)
  wfStepDefs: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    wfDefinitionId: v.id('wfDefinitions'),

    stepSlug: v.string(), // unique step slug identifier within workflow
    name: v.string(),
    description: v.optional(v.string()),
    stepType: v.union(
      v.literal('trigger'),
      v.literal('llm'), // Custom agent (flexible)
      v.literal('condition'),
      v.literal('action'),
      v.literal('loop'),
    ),
    order: v.number(), // execution order

    // Flow control - ports mapping
    nextSteps: v.record(v.string(), v.string()),

    // Step-specific configuration
    config: stepConfigValidator,

    // Input/output mapping
    inputMapping: v.optional(v.record(v.string(), v.string())),
    outputMapping: v.optional(v.record(v.string(), v.string())),

    metadata: v.optional(v.any()),
  })
    .index('by_definition', ['wfDefinitionId'])
    .index('by_definition_order', ['wfDefinitionId', 'order'])
    .index('by_step_slug', ['wfDefinitionId', 'stepSlug'])
    .index('by_organizationId_and_stepType_and_order', [
      'organizationId',
      'stepType',
      'order',
    ]),

  // WorkflowExecutions (execution state tracking)
  wfExecutions: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    wfDefinitionId: v.union(v.id('wfDefinitions'), v.string(), v.null()), // references workflow template, inline identifier, or null for inline workflows
    rootWfDefinitionId: v.optional(v.id('wfDefinitions')), // Root version of the workflow family (from wfDefinitions.rootVersionId)

    // Version tracking (for audit and debugging)
    workflowSlug: v.optional(v.string()), // Stable workflow identifier (snake_case of name) for entity tracking
    workflowVersion: v.optional(v.string()), // Version executed (e.g., "v2")

    status: v.string(), // 'pending' | 'running' | 'completed' | 'failed'
    currentStepSlug: v.string(), // current step slug being executed
    waitingFor: v.optional(v.string()), // 'approval' | null
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),

    // Link to component workflow runtime (get-convex/workflow)
    componentWorkflowId: v.optional(v.string()),

    // Thread management for workflow executions.
    // For LLM-heavy workflows, multiple steps can share this threadId for context.
    threadId: v.optional(v.string()),

    // Execution context and variables
    variables: v.optional(v.string()), // runtime variables (JSON serialized or storage reference)
    variablesStorageId: v.optional(v.id('_storage')), // storage file ID for large variables (>800KB)
    input: v.optional(v.any()), // initial input data
    output: v.optional(v.any()), // final output data

    // Workflow configuration (stored as JSON string to avoid nesting limits)
    workflowConfig: v.optional(v.string()),

    // Steps configuration (stored as JSON string to avoid nesting limits)
    stepsConfig: v.optional(v.string()),

    // Trigger information
    triggeredBy: v.optional(v.string()), // 'manual' | 'schedule' | 'webhook' | 'event'
    triggerData: v.optional(v.any()), // trigger-specific data

    // Error information (for failed executions)
    error: v.optional(v.string()),

    // Metadata (stored as JSON string)
    metadata: v.optional(v.string()),
  })
    .index('by_org', ['organizationId'])
    .index('by_definition', ['wfDefinitionId'])
    .index('by_definition_startedAt', ['wfDefinitionId', 'startedAt'])
    .index('by_status', ['status'])
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_component_workflow', ['componentWorkflowId']),

  // Approvals (unified approval system)
  approvals: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    wfExecutionId: v.optional(v.id('wfExecutions')), // references execution
    stepSlug: v.optional(v.string()), // references the approval step by workflow stepSlug
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
    ),

    approvedBy: v.optional(v.string()), // who actually approved/rejected it
    reviewedAt: v.optional(v.number()),

    // Resource identification
    resourceType: v.union(
      v.literal('conversations'),
      v.literal('product_recommendation'),
      v.literal('integration_operation'),
    ),
    resourceId: v.string(),

    // Thread context for chat-based approvals (Agent Component thread ID)
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()), // The message ID where approval was requested

    // Priority and timing
    priority: v.union(
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('urgent'),
    ),
    dueDate: v.optional(v.number()),

    // Execution tracking (for integration operations and other executed approvals)
    executedAt: v.optional(v.number()), // When the approved operation was executed
    executionError: v.optional(v.string()), // Error message if execution failed

    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_execution', ['wfExecutionId'])
    .index('by_org_status', ['organizationId', 'status'])
    .index('by_org_status_resourceType', [
      'organizationId',
      'status',
      'resourceType',
    ])
    .index('by_resource', ['resourceType', 'resourceId'])
    .index('by_resourceType_and_resourceId_and_status', [
      'resourceType',
      'resourceId',
      'status',
    ])
    .index('by_threadId_status_resourceType', [
      'threadId',
      'status',
      'resourceType',
    ]),

  // Tone of Voice - stores brand voice and example messages
  toneOfVoice: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    generatedTone: v.optional(v.string()), // AI-generated tone description
    lastUpdated: v.number(),
    metadata: v.optional(v.any()),
  }).index('by_organizationId', ['organizationId']),

  // Example Messages - examples used to generate tone of voice
  exampleMessages: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    toneOfVoiceId: v.id('toneOfVoice'),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    metadata: v.optional(v.any()),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_toneOfVoiceId', ['toneOfVoiceId'])
    .index('by_organizationId_and_toneOfVoiceId', [
      'organizationId',
      'toneOfVoiceId',
    ]),

  // Websites - website knowledge for AI context
  websites: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    domain: v.string(), // Website domain/URL
    title: v.optional(v.string()), // Website title
    description: v.optional(v.string()), // Website description
    scanInterval: v.string(), // e.g., "5d", "60m", "6h"
    lastScannedAt: v.optional(v.number()), // Last scan timestamp
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    metadata: v.optional(v.any()), // Additional flexible data
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_organizationId_and_status', ['organizationId', 'status'])
    .index('by_organizationId_and_domain', ['organizationId', 'domain']),

  // Website Pages - individual pages crawled from websites
  websitePages: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    websiteId: v.id('websites'), // Parent website
    url: v.string(), // Full page URL
    title: v.optional(v.string()), // Page title
    content: v.optional(v.string()), // Page content (markdown or text)
    wordCount: v.optional(v.number()), // Word count
    lastCrawledAt: v.number(), // Last crawl timestamp
    metadata: v.optional(v.record(v.string(), v.any())), // Page metadata as JSON object (description, keywords, author, etc.)
    structuredData: v.optional(v.record(v.string(), v.any())), // Structured data extracted from page (JSON object)
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_websiteId', ['websiteId'])
    .index('by_websiteId_and_lastCrawledAt', ['websiteId', 'lastCrawledAt'])
    .index('by_organizationId_and_url', ['organizationId', 'url']),

  // Workflow Processing Records - tracks which entities have been processed by workflows
  // This enables efficient incremental processing without scanning all entities
  workflowProcessingRecords: defineTable({
    organizationId: v.string(), // Better Auth organization ID
    tableName: v.string(), // 'customers' | 'products' | 'subscriptions' | etc.
    recordId: v.string(), // The _id of the processed record (stored as string for flexibility)
    wfDefinitionId: v.string(), // Workflow definition identifier (workflowSlug or wfDefinitionId)

    // Record metadata at time of processing
    recordCreationTime: v.number(), // _creationTime of the processed record

    // Processing metadata
    processedAt: v.number(), // When this record was processed or claimed
    status: v.optional(
      v.union(v.literal('in_progress'), v.literal('completed')),
    ), // Optional processing status for locking and auditing

    metadata: v.optional(v.any()),
  })
    .index('by_org_table_wfDefinition', [
      'organizationId',
      'tableName',
      'wfDefinitionId',
    ])
    .index('by_org_table_wfDefinition_creationTime', [
      'organizationId',
      'tableName',
      'wfDefinitionId',
      'recordCreationTime',
    ])
    .index('by_org_table_wfDefinition_processedAt', [
      'organizationId',
      'tableName',
      'wfDefinitionId',
      'processedAt',
    ])
    .index('by_record', ['tableName', 'recordId', 'wfDefinitionId']),

  // Message Metadata (for tracking LLM usage, tokens, model info)
  messageMetadata: defineTable({
    messageId: v.string(), // Agent Component message ID
    threadId: v.string(), // Agent Component thread ID
    model: v.string(), // e.g., 'gpt-4o'
    provider: v.string(), // e.g., 'openai'
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    reasoning: v.optional(v.string()), // Reasoning text if available
    providerMetadata: v.optional(v.any()), // Additional provider-specific data
  })
    .index('by_messageId', ['messageId'])
    .index('by_threadId', ['threadId']),
});
