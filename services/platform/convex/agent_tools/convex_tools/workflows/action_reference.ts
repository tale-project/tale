/**
 * Comprehensive Action Reference
 *
 * This file contains detailed information about all available actions,
 * their operations, and required/optional parameters for each operation.
 */

export interface OperationInfo {
  operation: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  example: string;
}

export interface ActionReference {
  type: string;
  title: string;
  description: string;
  category: string;
  operations: OperationInfo[];
}

/**
 * Complete action reference with all operations and parameters
 */
export const ACTION_REFERENCE: ActionReference[] = [
  {
    type: 'customer',
    title: 'Customer Operation',
    description: 'Execute customer-specific operations',
    category: 'customer',
    operations: [
      {
        operation: 'create',
        description: 'Create a new customer',
        requiredParams: ['operation', 'organizationId', 'name'],
        optionalParams: [
          'email',
          'phone',
          'externalId',
          'status',
          'source',
          'locale',
          'tags',
          'totalSpent',
          'orderCount',
          'notes',
          'metadata',
        ],
        example:
          '{ action: "customer", parameters: { operation: "create", organizationId: "{{organizationId}}", name: "John Doe", email: "john@example.com" } }',
      },
      {
        operation: 'get_by_id',
        description: 'Get a customer by ID',
        requiredParams: ['operation', 'customerId'],
        optionalParams: [],
        example:
          '{ action: "customer", parameters: { operation: "get_by_id", customerId: "{{customerId}}" } }',
      },
      {
        operation: 'query',
        description: 'Query customers with pagination',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "customer", parameters: { operation: "query", organizationId: "{{organizationId}}", paginationOpts: { numItems: 10, cursor: null } } }',
      },
      {
        operation: 'filter',
        description: 'Filter customers using JEXL expression',
        requiredParams: ['operation', 'organizationId', 'expression'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "customer", parameters: { operation: "filter", organizationId: "{{organizationId}}", expression: "status == \'active\' && totalSpent > 100" } }',
      },
      {
        operation: 'update',
        description: 'Update a customer',
        requiredParams: ['operation', 'customerId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "customer", parameters: { operation: "update", customerId: "{{customerId}}", updates: { status: "churned" } } }',
      },
    ],
  },
  {
    type: 'product',
    title: 'Product Operation',
    description: 'Execute product-specific operations',
    category: 'product',
    operations: [
      {
        operation: 'create',
        description: 'Create a new product',
        requiredParams: ['operation', 'organizationId', 'name'],
        optionalParams: [
          'description',
          'imageUrl',
          'stock',
          'price',
          'currency',
          'category',
          'tags',
          'status',
          'externalId',
          'metadata',
        ],
        example:
          '{ action: "product", parameters: { operation: "create", organizationId: "{{organizationId}}", name: "Premium Laptop", price: 1299 } }',
      },
      {
        operation: 'get_by_id',
        description: 'Get a product by ID',
        requiredParams: ['operation', 'productId'],
        optionalParams: [],
        example:
          '{ action: "product", parameters: { operation: "get_by_id", productId: "{{productId}}" } }',
      },
      {
        operation: 'query',
        description: 'Query products with pagination',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "product", parameters: { operation: "query", organizationId: "{{organizationId}}" } }',
      },
      {
        operation: 'filter',
        description: 'Filter products using JEXL expression',
        requiredParams: ['operation', 'organizationId', 'expression'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "product", parameters: { operation: "filter", organizationId: "{{organizationId}}", expression: "status == \'active\' && price > 100" } }',
      },
      {
        operation: 'update',
        description: 'Update a product',
        requiredParams: ['operation', 'productId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "product", parameters: { operation: "update", productId: "{{productId}}", updates: { stock: 50 } } }',
      },
      {
        operation: 'hydrate_fields',
        description: 'Hydrate product fields with external data',
        requiredParams: ['operation', 'organizationId', 'externalId'],
        optionalParams: [],
        example:
          '{ action: "product", parameters: { operation: "hydrate_fields", organizationId: "{{organizationId}}", externalId: "ext_123" } }',
      },
    ],
  },
  {
    type: 'conversation',
    title: 'Conversation Operation',
    description: 'Execute conversation-specific operations',
    category: 'conversation',
    operations: [
      {
        operation: 'create',
        description: 'Create a new conversation',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [
          'customerId',
          'subject',
          'status',
          'priority',
          'type',
          'channel',
          'direction',
          'providerId',
          'metadata',
        ],
        example:
          '{ action: "conversation", parameters: { operation: "create", organizationId: "{{organizationId}}", customerId: "{{customerId}}", subject: "Product Inquiry" } }',
      },
      {
        operation: 'get_by_id',
        description: 'Get a conversation by ID',
        requiredParams: ['operation', 'conversationId'],
        optionalParams: [],
        example:
          '{ action: "conversation", parameters: { operation: "get_by_id", conversationId: "{{conversationId}}" } }',
      },
      {
        operation: 'query',
        description: 'Query conversations with pagination',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "conversation", parameters: { operation: "query", organizationId: "{{organizationId}}" } }',
      },
      {
        operation: 'query_messages',
        description: 'Query messages in a conversation',
        requiredParams: ['operation', 'conversationId'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "conversation", parameters: { operation: "query_messages", conversationId: "{{conversationId}}" } }',
      },
      {
        operation: 'query_latest_message_by_delivery_state',
        description: 'Query latest message by delivery state',
        requiredParams: ['operation', 'conversationId', 'deliveryState'],
        optionalParams: [],
        example:
          '{ action: "conversation", parameters: { operation: "query_latest_message_by_delivery_state", conversationId: "{{conversationId}}", deliveryState: "delivered" } }',
      },
      {
        operation: 'update',
        description: 'Update a conversation',
        requiredParams: ['operation', 'conversationId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "conversation", parameters: { operation: "update", conversationId: "{{conversationId}}", updates: { status: "closed" } } }',
      },
      {
        operation: 'create_from_email',
        description: 'Create conversation from email',
        requiredParams: [
          'operation',
          'organizationId',
          'email',
          'accountEmail',
        ],
        optionalParams: [],
        example:
          '{ action: "conversation", parameters: { operation: "create_from_email", organizationId: "{{organizationId}}", email: {{emailObject}}, accountEmail: "support@example.com" } }',
      },
      {
        operation: 'create_from_sent_email',
        description: 'Create conversation from sent email',
        requiredParams: [
          'operation',
          'organizationId',
          'emails',
          'accountEmail',
        ],
        optionalParams: [],
        example:
          '{ action: "conversation", parameters: { operation: "create_from_sent_email", organizationId: "{{organizationId}}", emails: [{{emailObject}}], accountEmail: "support@example.com" } }',
      },
    ],
  },
  {
    type: 'document',
    title: 'Document Operation',
    description: 'Execute document-specific operations',
    category: 'document',
    operations: [
      {
        operation: 'create',
        description: 'Create a new document',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [
          'title',
          'content',
          'fileId',
          'metadata',
          'sourceProvider',
        ],
        example:
          '{ action: "document", parameters: { operation: "create", organizationId: "{{organizationId}}", title: "Product Guide", content: "..." } }',
      },
      {
        operation: 'get_by_id',
        description: 'Get a document by ID',
        requiredParams: ['operation', 'documentId'],
        optionalParams: [],
        example:
          '{ action: "document", parameters: { operation: "get_by_id", documentId: "{{documentId}}" } }',
      },
      {
        operation: 'query',
        description: 'Query documents with pagination',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: ['paginationOpts'],
        example:
          '{ action: "document", parameters: { operation: "query", organizationId: "{{organizationId}}" } }',
      },
      {
        operation: 'update',
        description: 'Update a document',
        requiredParams: ['operation', 'documentId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "document", parameters: { operation: "update", documentId: "{{documentId}}", updates: { title: "Updated Title" } } }',
      },
      {
        operation: 'generate_signed_url',
        description: 'Generate signed URL for document',
        requiredParams: ['operation', 'documentId'],
        optionalParams: [],
        example:
          '{ action: "document", parameters: { operation: "generate_signed_url", documentId: "{{documentId}}" } }',
      },
    ],
  },
  {
    type: 'approval',
    title: 'Approval Operation',
    description: 'Execute approval workflow operations',
    category: 'workflow',
    operations: [
      {
        operation: 'create_approval',
        description: 'Create a new approval request',
        requiredParams: [
          'operation',
          'organizationId',
          'resourceType',
          'resourceId',
        ],
        optionalParams: [
          'priority',
          'requestedBy',
          'dueDate',
          'description',
          'stepSlug',
          'metadata',
          'executionId',
        ],
        example:
          '{ action: "approval", parameters: { operation: "create_approval", organizationId: "{{organizationId}}", resourceType: "email", resourceId: "{{conversationId}}", priority: "high" } }',
      },
      {
        operation: 'update_approval_status',
        description: 'Update approval status',
        requiredParams: ['operation', 'approvalId', 'status'],
        optionalParams: ['approvedBy', 'comments'],
        example:
          '{ action: "approval", parameters: { operation: "update_approval_status", approvalId: "{{approvalId}}", status: "approved", approvedBy: "user@example.com" } }',
      },
      {
        operation: 'get_approval',
        description: 'Get approval by ID',
        requiredParams: ['operation', 'approvalId'],
        optionalParams: [],
        example:
          '{ action: "approval", parameters: { operation: "get_approval", approvalId: "{{approvalId}}" } }',
      },
      {
        operation: 'list_pending_approvals',
        description: 'List all pending approvals',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "approval", parameters: { operation: "list_pending_approvals", organizationId: "{{organizationId}}" } }',
      },
      {
        operation: 'list_approvals_for_execution',
        description: 'List approvals for a workflow execution',
        requiredParams: ['operation', 'executionId'],
        optionalParams: [],
        example:
          '{ action: "approval", parameters: { operation: "list_approvals_for_execution", executionId: "{{executionId}}" } }',
      },
      {
        operation: 'list_pending_approvals_for_execution',
        description: 'List pending approvals for a workflow execution',
        requiredParams: ['operation', 'executionId'],
        optionalParams: [],
        example:
          '{ action: "approval", parameters: { operation: "list_pending_approvals_for_execution", executionId: "{{executionId}}" } }',
      },
      {
        operation: 'get_approval_history',
        description: 'Get approval history',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "approval", parameters: { operation: "get_approval_history", organizationId: "{{organizationId}}" } }',
      },
    ],
  },
  {
    type: 'workflow_processing_records',
    title: 'Workflow Processing Records Operation',
    description: 'Track which entities have been processed by workflows',
    category: 'workflow',
    operations: [
      {
        operation: 'find_unprocessed',
        description: 'Find one unprocessed entity from a table',
        requiredParams: [
          'operation',
          'organizationId',
          'tableName',
          'workflowId',
          'backoffHours',
        ],
        optionalParams: [],
        example:
          '{ action: "workflow_processing_records", parameters: { operation: "find_unprocessed", organizationId: "{{organizationId}}", tableName: "customers", workflowId: "{{workflowId}}", backoffHours: 24 } }',
      },
      {
        operation: 'find_unprocessed_open_conversation',
        description: 'Find one unprocessed open conversation',
        requiredParams: [
          'operation',
          'organizationId',
          'workflowId',
          'backoffHours',
        ],
        optionalParams: [],
        example:
          '{ action: "workflow_processing_records", parameters: { operation: "find_unprocessed_open_conversation", organizationId: "{{organizationId}}", workflowId: "{{workflowId}}", backoffHours: 24 } }',
      },
      {
        operation: 'find_product_recommendation_by_status',
        description: 'Find product recommendation by approval status',
        requiredParams: [
          'operation',
          'organizationId',
          'workflowId',
          'backoffHours',
          'status',
        ],
        optionalParams: [],
        example:
          '{ action: "workflow_processing_records", parameters: { operation: "find_product_recommendation_by_status", organizationId: "{{organizationId}}", workflowId: "{{workflowId}}", backoffHours: 24, status: "approved" } }',
      },
      {
        operation: 'record_processed',
        description: 'Record that an entity has been processed',
        requiredParams: [
          'operation',
          'organizationId',
          'tableName',
          'recordId',
          'wfDefinitionId',
          'recordCreationTime',
        ],
        optionalParams: ['metadata'],
        example:
          '{ action: "workflow_processing_records", parameters: { operation: "record_processed", organizationId: "{{organizationId}}", tableName: "customers", recordId: "{{customerId}}", wfDefinitionId: "{{wfDefinitionId}}", recordCreationTime: {{customer._creationTime}} } }',
      },
    ],
  },
  {
    type: 'email_provider',
    title: 'Email Provider Operation',
    description: 'Manage email provider configurations',
    category: 'email',
    operations: [
      {
        operation: 'get_default',
        description: 'Get default email provider for organization',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "email_provider", parameters: { operation: "get_default", organizationId: "{{organizationId}}" } }',
      },
      {
        operation: 'get_imap_credentials',
        description: 'Get IMAP credentials for email provider',
        requiredParams: ['operation', 'providerId'],
        optionalParams: [],
        example:
          '{ action: "email_provider", parameters: { operation: "get_imap_credentials", providerId: "{{providerId}}" } }',
      },
    ],
  },
  {
    type: 'imap',
    title: 'IMAP Operation',
    description: 'Retrieve emails via IMAP protocol',
    category: 'email',
    operations: [
      {
        operation: 'list',
        description: 'List emails from mailbox',
        requiredParams: ['operation'],
        optionalParams: ['afterUid', 'limit'],
        example:
          '{ action: "imap", parameters: { operation: "list", afterUid: 1000, limit: 50 } }',
      },
      {
        operation: 'search',
        description: 'Search emails in mailbox',
        requiredParams: ['operation'],
        optionalParams: ['afterUid', 'limit'],
        example:
          '{ action: "imap", parameters: { operation: "search", afterUid: 1000 } }',
      },
    ],
  },
  {
    type: 'shopify',
    title: 'Shopify Integration',
    description: 'Interact with Shopify API',
    category: 'integration',
    operations: [
      {
        operation: 'list',
        description:
          'List Shopify resources (products, customers, orders, etc.)',
        requiredParams: ['operation', 'resource'],
        optionalParams: ['limit', 'sinceId', 'fields'],
        example:
          '{ action: "shopify", parameters: { operation: "list", resource: "products", limit: 50 } }',
      },
      {
        operation: 'get',
        description: 'Get a specific Shopify resource by ID',
        requiredParams: ['operation', 'resource', 'id'],
        optionalParams: ['fields'],
        example:
          '{ action: "shopify", parameters: { operation: "get", resource: "products", id: "12345" } }',
      },
      {
        operation: 'count',
        description: 'Count Shopify resources',
        requiredParams: ['operation', 'resource'],
        optionalParams: [],
        example:
          '{ action: "shopify", parameters: { operation: "count", resource: "products" } }',
      },
    ],
  },
  {
    type: 'circuly',
    title: 'Circuly Integration',
    description: 'Interact with Circuly API',
    category: 'integration',
    operations: [
      {
        operation: 'list',
        description:
          'List Circuly resources (products, customers, subscriptions)',
        requiredParams: ['operation', 'resource'],
        optionalParams: ['limit', 'offset'],
        example:
          '{ action: "circuly", parameters: { operation: "list", resource: "customers", limit: 50 } }',
      },
    ],
  },
  {
    type: 'integrations',
    title: 'Integrations Operation',
    description: 'Manage third-party integrations',
    category: 'integration',
    operations: [
      {
        operation: 'get_by_provider',
        description: 'Get integration by provider name',
        requiredParams: ['operation', 'organizationId', 'provider'],
        optionalParams: [],
        example:
          '{ action: "integrations", parameters: { operation: "get_by_provider", organizationId: "{{organizationId}}", provider: "shopify" } }',
      },
    ],
  },
  {
    type: 'rag',
    title: 'RAG (Knowledge Base) Operation',
    description: 'Manage knowledge base documents for RAG',
    category: 'knowledge',
    operations: [
      {
        operation: 'upload_document',
        description: 'Upload document to knowledge base',
        requiredParams: ['operation', 'documentId', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "rag", parameters: { operation: "upload_document", documentId: "{{documentId}}", organizationId: "{{organizationId}}" } }',
      },
    ],
  },
  {
    type: 'crawler',
    title: 'Web Crawler Operation',
    description: 'Crawl websites and extract content',
    category: 'web',
    operations: [
      {
        operation: 'crawl_website',
        description: 'Crawl a website starting from a URL',
        requiredParams: ['operation', 'url'],
        optionalParams: ['maxPages', 'maxDepth'],
        example:
          '{ action: "crawler", parameters: { operation: "crawl_website", url: "https://example.com", maxPages: 10 } }',
      },
      {
        operation: 'discover_urls',
        description: 'Discover URLs from a starting URL',
        requiredParams: ['operation', 'url'],
        optionalParams: ['maxUrls'],
        example:
          '{ action: "crawler", parameters: { operation: "discover_urls", url: "https://example.com", maxUrls: 50 } }',
      },
      {
        operation: 'fetch_urls',
        description: 'Fetch content from multiple URLs',
        requiredParams: ['operation', 'urls'],
        optionalParams: [],
        example:
          '{ action: "crawler", parameters: { operation: "fetch_urls", urls: ["https://example.com/page1", "https://example.com/page2"] } }',
      },
    ],
  },
  {
    type: 'website',
    title: 'Website Operation',
    description: 'Manage website configurations',
    category: 'web',
    operations: [
      {
        operation: 'create',
        description: 'Create a new website configuration',
        requiredParams: ['operation', 'organizationId', 'domain'],
        optionalParams: ['name', 'description', 'scanInterval', 'maxPages'],
        example:
          '{ action: "website", parameters: { operation: "create", organizationId: "{{organizationId}}", domain: "example.com", scanInterval: "daily" } }',
      },
      {
        operation: 'update',
        description: 'Update website configuration',
        requiredParams: ['operation', 'websiteId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "website", parameters: { operation: "update", websiteId: "{{websiteId}}", updates: { scanInterval: "weekly" } } }',
      },
      {
        operation: 'get_by_domain',
        description: 'Get website by domain',
        requiredParams: ['operation', 'domain', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "website", parameters: { operation: "get_by_domain", domain: "example.com", organizationId: "{{organizationId}}" } }',
      },
    ],
  },
  {
    type: 'websitePages',
    title: 'Website Pages Operation',
    description: 'Manage website pages',
    category: 'web',
    operations: [
      {
        operation: 'bulk_upsert',
        description: 'Bulk upsert website pages',
        requiredParams: ['operation', 'organizationId', 'websiteId', 'pages'],
        optionalParams: [],
        example:
          '{ action: "websitePages", parameters: { operation: "bulk_upsert", organizationId: "{{organizationId}}", websiteId: "{{websiteId}}", pages: [{ url: "https://example.com/page1", title: "Page 1", content: "..." }] } }',
      },
    ],
  },
  {
    type: 'onedrive',
    title: 'OneDrive Integration',
    description: 'Interact with Microsoft OneDrive',
    category: 'integration',
    operations: [
      {
        operation: 'get_user_token',
        description: 'Get OneDrive user token',
        requiredParams: ['operation', 'userId'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "get_user_token", userId: "{{userId}}" } }',
      },
      {
        operation: 'refresh_token',
        description: 'Refresh OneDrive access token',
        requiredParams: ['operation', 'refreshToken'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "refresh_token", refreshToken: "{{refreshToken}}" } }',
      },
      {
        operation: 'read_file',
        description: 'Read file from OneDrive',
        requiredParams: ['operation', 'itemId', 'token'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "read_file", itemId: "{{fileId}}", token: "{{token}}" } }',
      },
      {
        operation: 'list_folder_contents',
        description: 'List contents of a OneDrive folder',
        requiredParams: ['operation', 'itemId', 'token'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "list_folder_contents", itemId: "{{folderId}}", token: "{{token}}" } }',
      },
      {
        operation: 'create_file_sync_configs',
        description: 'Create file sync configurations',
        requiredParams: ['operation', 'organizationId', 'configs'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "create_file_sync_configs", organizationId: "{{organizationId}}", configs: [{ itemId: "file1", syncEnabled: true }] } }',
      },
      {
        operation: 'sync_folder_files',
        description: 'Sync files from OneDrive folder',
        requiredParams: ['operation', 'organizationId', 'folderId'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "sync_folder_files", organizationId: "{{organizationId}}", folderId: "{{folderId}}" } }',
      },
      {
        operation: 'upload_to_storage',
        description: 'Upload OneDrive file to Convex storage',
        requiredParams: ['operation', 'itemId', 'token'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "upload_to_storage", itemId: "{{fileId}}", token: "{{token}}" } }',
      },
      {
        operation: 'update_sync_config',
        description: 'Update file sync configuration',
        requiredParams: ['operation', 'configId', 'updates'],
        optionalParams: [],
        example:
          '{ action: "onedrive", parameters: { operation: "update_sync_config", configId: "{{configId}}", updates: { syncEnabled: false } } }',
      },
    ],
  },
  {
    type: 'tone_of_voice',
    title: 'Tone of Voice Operation',
    description: 'Get organization tone of voice settings',
    category: 'workflow',
    operations: [
      {
        operation: 'get_tone_of_voice',
        description: 'Get tone of voice for organization',
        requiredParams: ['operation', 'organizationId'],
        optionalParams: [],
        example:
          '{ action: "tone_of_voice", parameters: { operation: "get_tone_of_voice", organizationId: "{{organizationId}}" } }',
      },
    ],
  },
  {
    type: 'set_variables',
    title: 'Set Variables',
    description: 'Update workflow variables',
    category: 'workflow',
    operations: [
      {
        operation: 'set',
        description: 'Set workflow variables',
        requiredParams: ['variables'],
        optionalParams: [],
        example:
          '{ action: "set_variables", parameters: { variables: [{ name: "customerEmail", value: "{{customer.email}}" }, { name: "apiKey", value: "{{secrets.apiKey}}", secure: true }] } }',
      },
    ],
  },
];
