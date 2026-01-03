/**
 * Modular Syntax Reference for Workflow Agent
 *
 * Contains workflow syntax broken into categories for on-demand retrieval.
 * This replaces embedding WORKFLOW_SYNTAX_COMPACT in system prompt.
 */


/**
 * Syntax modules organized by category
 */
export const SYNTAX_MODULES: Record<string, string> = {
  quick_start: `## WORKFLOW QUICK START GUIDE

**DECISION TREE - Choose the right pattern:**

Processing multiple entities (customers/products/conversations/approvals)?
├── YES → Use Entity Processing pattern
│   └── Examples: generalCustomerStatusAssessment, productRecommendationEmail, conversationAutoReply
└── NO → Sending email?
    ├── YES → Use Email Sending pattern (conversation + approval)
    │   └── Examples: productRecommendationEmail, conversationAutoReply
    └── NO → Syncing external data (Shopify, IMAP, OneDrive)?
        ├── YES → Use Data Sync pattern (with pagination)
        │   └── Examples: shopifySyncProducts, shopifySyncCustomers, emailSyncImap
        └── NO → Syncing to RAG/knowledge base?
            ├── YES → Use RAG Sync pattern
            │   └── Examples: documentRagSync, productRagSync, customerRagSync
            └── NO → Use LLM Analysis + Action pattern
                └── Examples: generalProductRecommendation, productRelationshipAnalysis

**COMMON MISTAKES TO AVOID:**
❌ Using loop to process all entities → ✅ Use entity_processing (one per execution)
❌ nextSteps inside config → ✅ nextSteps at same level as config
❌ Using "prompt" field → ✅ Use "systemPrompt" + "userPrompt"
❌ Forgetting record_processed → ✅ Always call record_processed after processing
❌ Direct send_email action → ✅ Use conversation + approval pattern
❌ Missing "name" in LLM step → ✅ LLM config requires "name" field
❌ Missing "type" in action step → ✅ Action config requires "type" field

**STEP TYPE QUICK REFERENCE:**
- trigger: Start workflow (scheduled/manual/webhook/event)
- action: CRUD operations, set_variables, integrations, approvals
- llm: AI decision-making and content generation (requires name + systemPrompt)
- condition: JEXL expression branching (nextSteps: true/false)
- loop: Iterate over arrays (for data sync, NOT entity processing)

**NEXT STEPS:**
1. Get pattern details: workflow_examples(operation='get_syntax_reference', category='common_patterns')
2. Study similar workflow: workflow_examples(operation='get_predefined', workflowKey='...')
3. Get step syntax: workflow_examples(operation='get_syntax_reference', category='trigger|llm|action|condition|loop')`,

  common_patterns: `## COMMON WORKFLOW PATTERNS

### Pattern 1: Entity Processing (Most Common)
Process customers/products/conversations one at a time. Each execution handles ONE entity.

**Structure:** trigger → find_unprocessed → condition → process → record_processed → noop

**Skeleton:**
\`\`\`json
[
  { "stepSlug": "start", "stepType": "trigger", "config": { "type": "scheduled", "schedule": "0 */2 * * *", "timezone": "UTC" }, "nextSteps": { "success": "find_entity" } },
  { "stepSlug": "find_entity", "stepType": "action", "config": { "type": "workflow_processing_records", "parameters": { "operation": "find_unprocessed", "tableName": "customers", "backoffHours": "{{backoffHours}}", "filterExpression": "status == \\"active\\"" } }, "nextSteps": { "success": "check_found" } },
  { "stepSlug": "check_found", "stepType": "condition", "config": { "expression": "steps.find_entity.output.data != null" }, "nextSteps": { "true": "extract_data", "false": "noop" } },
  { "stepSlug": "extract_data", "stepType": "action", "config": { "type": "set_variables", "parameters": { "variables": [{ "name": "entityId", "value": "{{steps.find_entity.output.data._id}}" }] } }, "nextSteps": { "success": "process" } },
  { "stepSlug": "process", "stepType": "llm", "config": { "name": "Process Entity", "systemPrompt": "You are an analyst...", "userPrompt": "Analyze: {{steps.find_entity.output.data}}", "outputFormat": "json" }, "nextSteps": { "success": "record_processed" } },
  { "stepSlug": "record_processed", "stepType": "action", "config": { "type": "workflow_processing_records", "parameters": { "operation": "record_processed", "tableName": "customers", "recordId": "{{entityId}}" } }, "nextSteps": { "success": "noop" } }
]
\`\`\`

### Pattern 2: Email Sending
Create conversation with email metadata, then create approval. Email sends when approved.

**Structure:** ... → create_conversation → create_approval → record_processed → noop

**Key Steps:**
\`\`\`json
{ "stepSlug": "create_conversation", "stepType": "action", "config": { "type": "conversation", "parameters": { "operation": "create", "customerId": "{{customerId}}", "subject": "{{emailSubject}}", "channel": "email", "direction": "outbound", "metadata": { "emailSubject": "{{emailSubject}}", "emailBody": "{{emailBody}}", "emailPreview": "{{preview}}", "customerEmail": "{{customerEmail}}" } } }, "nextSteps": { "success": "create_approval" } },
{ "stepSlug": "create_approval", "stepType": "action", "config": { "type": "approval", "parameters": { "operation": "create_approval", "resourceType": "conversations", "resourceId": "{{steps.create_conversation.output.data._id}}", "priority": "medium", "description": "Review email before sending" } }, "nextSteps": { "success": "record_processed" } }
\`\`\`

### Pattern 3: LLM Analysis + Action
AI analyzes data, outputs JSON, then condition branches based on result.

**Structure:** ... → compose_prompts → llm_analyze → condition → action_based_on_result

**LLM Step with JSON Output:**
\`\`\`json
{ "stepSlug": "analyze", "stepType": "llm", "config": { "name": "Analyzer", "systemPrompt": "You are an expert analyst. Analyze the data and return a structured decision.", "userPrompt": "Analyze: {{data}}", "temperature": 0.3, "maxTokens": 2000, "maxSteps": 10, "outputFormat": "json", "outputSchema": { "type": "object", "properties": { "decision": { "type": "string", "enum": ["approve", "reject", "review"] }, "reasoning": { "type": "string" } }, "required": ["decision", "reasoning"] }, "tools": ["rag_search", "customer_search", "product_get"] }, "nextSteps": { "success": "check_decision" } }
\`\`\`

### Pattern 4: Data Sync with Pagination
Sync external data sources (Shopify, IMAP) with cursor-based pagination.

**Structure:** trigger → fetch_page → loop_items → upsert_each → check_next_page → [true] update_cursor → fetch_page

**Integration Fetch:**
\`\`\`json
{ "stepSlug": "fetch_products", "stepType": "action", "config": { "type": "integration", "parameters": { "name": "shopify", "operation": "list_products", "params": { "limit": "{{pageSize}}", "page_info": "{{nextPageInfo}}" } } }, "nextSteps": { "success": "loop_products" } }
\`\`\`

**Loop Through Items:**
\`\`\`json
{ "stepSlug": "loop_products", "stepType": "loop", "config": { "items": "{{steps.fetch_products.output.data.result.data}}", "itemVariable": "product" }, "nextSteps": { "loop": "process_item", "done": "check_has_next_page" } }
\`\`\`

### Pattern 5: RAG Sync
Upload documents/products/customers to knowledge base.

**Structure:** trigger → find_unprocessed → condition → prepare_content → upload_to_rag → update_metadata → record_processed

**RAG Upload Action:**
\`\`\`json
{ "stepSlug": "upload_to_rag", "stepType": "action", "config": { "type": "rag", "parameters": { "operation": "upload", "content": "{{documentContent}}", "metadata": { "sourceId": "{{documentId}}", "sourceType": "document" } } }, "nextSteps": { "success": "record_processed" } }
\`\`\``,

  trigger: `## Trigger Step (stepType: 'trigger')

Config: { type: 'manual'|'scheduled'|'webhook'|'event', inputs?, schedule?, timezone?, context? }
NextSteps: { success: 'next_step_slug' }

**Scheduled Trigger Example:**
\`\`\`json
{
  "type": "scheduled",
  "schedule": "0 */2 * * *",
  "timezone": "UTC"
}
\`\`\`

**Manual Trigger Example:**
\`\`\`json
{
  "type": "manual",
  "inputs": {
    "customerId": { "type": "string", "required": true }
  }
}
\`\`\`

**Cron Schedule Reference:**
- "0 */2 * * *" = every 2 hours
- "0 9 * * *" = daily at 9 AM
- "0 0 * * 1" = weekly on Monday`,

  llm: `## LLM Step (stepType: 'llm')

Config: { name (REQUIRED), systemPrompt (REQUIRED), userPrompt?, temperature?, maxTokens?, maxSteps?, tools?: string[], outputFormat?: 'text'|'json', outputSchema?, contextVariables? }
NextSteps: { success: 'next_step', error?: 'error_handler' }

**CRITICAL FIELDS:**
- name: REQUIRED - human-readable name
- systemPrompt: REQUIRED - role and instructions (NOT "prompt")

**LLM Step Example:**
\`\`\`json
{
  "name": "Analyze Customer",
  "systemPrompt": "You are a customer analyst. Analyze the customer data and provide insights.",
  "userPrompt": "Analyze this customer: {{steps.get_customer.output.data}}",
  "temperature": 0.7,
  "maxTokens": 2000,
  "tools": ["product_get", "list_products"],
  "outputFormat": "json"
}
\`\`\`

**Available Tools for LLM Steps:**
- customer_search, customer_get
- product_get, list_products
- rag_search (knowledge base)
- conversation_query`,

  action: `## Action Step (stepType: 'action')

Config: { type (action type), parameters, retryPolicy? }
NextSteps: { success: 'next_step', error?: 'error_handler' }

**IMPORTANT:** stepType is 'action', the config.type specifies the action type.

**ACTION TYPES:**

### workflow_processing_records
Operations: find_unprocessed, record_processed
\`\`\`json
{
  "type": "workflow_processing_records",
  "parameters": {
    "operation": "find_unprocessed",
    "tableName": "customers",
    "backoffHours": 168,
    "filterExpression": "status == \\"active\\""
  }
}
\`\`\`

### customer
Operations: create, query, filter, update
\`\`\`json
{
  "type": "customer",
  "parameters": {
    "operation": "query",
    "status": "active",
    "paginationOpts": { "numItems": 10, "cursor": null }
  }
}
\`\`\`

### product
Operations: create, get_by_id, query, filter, update, hydrate_fields

### conversation
Operations: create, query_messages, update, create_from_email

### approval
Operation: create_approval
\`\`\`json
{
  "type": "approval",
  "parameters": {
    "operation": "create_approval",
    "resourceType": "conversations",
    "resourceId": "{{steps.create_conv.output.data._id}}",
    "priority": "medium",
    "description": "Review before sending"
  }
}
\`\`\`

### set_variables
\`\`\`json
{
  "type": "set_variables",
  "parameters": {
    "variables": [
      { "name": "customerId", "value": "{{steps.find.output.data._id}}" }
    ]
  }
}
\`\`\`

### integration
For external APIs (Shopify, Circuly, etc.)
\`\`\`json
{
  "type": "integration",
  "parameters": {
    "name": "shopify",
    "operation": "getProducts",
    "params": { "limit": 50 }
  }
}
\`\`\``,

  condition: `## Condition Step (stepType: 'condition')

Config: { expression (JEXL), description?, variables? }
NextSteps: { true: 'if_true_step', false: 'if_false_step' }

**Condition Example:**
\`\`\`json
{
  "expression": "steps.find_customer.output.data != null"
}
\`\`\`

**Common Expressions:**
- Check entity exists: \`steps.find_step.output.data != null\`
- Check array not empty: \`steps.query.output.data.length > 0\`
- Compare values: \`steps.check.output.data.status == "active"\`
- Boolean logic: \`status == "active" && count > 5\``,

  loop: `## Loop Step (stepType: 'loop')

Config: { items, itemVariable?: 'item', indexVariable?: 'index', maxIterations?: 1000, continueOnError? }
NextSteps: { loop: 'loop_body_step', done: 'after_loop_step', error?: 'error_handler' }

**Loop Example:**
\`\`\`json
{
  "items": "{{steps.query_customers.output.data}}",
  "itemVariable": "customer",
  "maxIterations": 100
}
\`\`\`

**Loop Variable Access:**
- Current item: {{loop.item}}
- Current index: {{loop.index}}
- Iteration count: {{loop.state.iterations}}`,

  email: `## EMAIL SENDING PATTERN

Workflows DO NOT have a direct "send_email" action. Use the conversation + approval pattern:

### Step 1: Create Conversation with Email Metadata
\`\`\`json
{
  "stepType": "action",
  "config": {
    "type": "conversation",
    "parameters": {
      "operation": "create",
      "customerId": "{{customerId}}",
      "subject": "{{emailSubject}}",
      "channel": "email",
      "direction": "outbound",
      "metadata": {
        "emailSubject": "{{emailSubject}}",
        "emailBody": "{{emailBody}}",
        "emailPreview": "{{emailPreview}}",
        "customerEmail": "{{customerEmail}}"
      }
    }
  }
}
\`\`\`

### Step 2: Create Approval for Email Review
\`\`\`json
{
  "stepType": "action",
  "config": {
    "type": "approval",
    "parameters": {
      "operation": "create_approval",
      "resourceType": "conversations",
      "resourceId": "{{steps.create_conversation.output.data._id}}",
      "priority": "medium",
      "description": "Review email before sending"
    }
  }
}
\`\`\`

### How It Works
- Approval appears in dashboard for human review
- When approved, system automatically sends the email
- Conversation tracks the email thread for replies

### Required Metadata Fields
- emailSubject: Email subject line
- emailBody: HTML or Markdown email body
- customerEmail: Recipient email address

### Optional Metadata Fields
- emailPreview: Preview text for inbox
- emailCc, emailBcc: CC/BCC recipients

**Reference:** Use workflow_examples(operation='get_predefined', workflowKey='productRecommendationEmail') for complete example`,

  entity_processing: `## ENTITY PROCESSING PATTERN (One-at-a-Time)

For workflows that process multiple entities (customers, products, conversations):

### Standard Structure
\`\`\`
Step 1: Scheduled Trigger (e.g., "0 */2 * * *")
Step 2: workflow_processing_records(find_unprocessed)
Step 3: Condition (data != null)
Step 4-N: Process entity (LLM steps for business logic)
Step N+1: workflow_processing_records(record_processed)
\`\`\`

### Find Unprocessed Entity
\`\`\`json
{
  "stepType": "action",
  "config": {
    "type": "workflow_processing_records",
    "parameters": {
      "operation": "find_unprocessed",
      "tableName": "customers",
      "backoffHours": 168,
      "filterExpression": "status == \\"active\\""
    }
  }
}
\`\`\`

### Check If Found
\`\`\`json
{
  "stepType": "condition",
  "config": {
    "expression": "steps.find_customer.output.data != null"
  },
  "nextSteps": {
    "true": "process_customer",
    "false": "noop"
  }
}
\`\`\`

### Record as Processed
\`\`\`json
{
  "stepType": "action",
  "config": {
    "type": "workflow_processing_records",
    "parameters": {
      "operation": "record_processed",
      "tableName": "customers",
      "recordId": "{{steps.find_customer.output.data._id}}",
      "recordCreationTime": "{{steps.find_customer.output.data._creationTime}}"
    }
  }
}
\`\`\`

### Key Points
- Process ONE entity per workflow run (scheduled trigger runs repeatedly)
- backoffHours prevents reprocessing (e.g., 168 = 7 days)
- filterExpression uses JEXL syntax for filtering
- Use 'noop' in nextSteps to gracefully end workflow when no entity found`,

  variables: `## VARIABLE SYNTAX

### Simple Variables
- {{variableName}}
- {{customer.email}}
- {{items[0].name}}

### Step Output Access
Action outputs are wrapped: steps.{step_slug}.output.data
- Single entity: {{steps.get_customer.output.data._id}}
- Array item: {{steps.query.output.data[0]._id}}
- Array length: {{steps.query.output.data.length}}
- Paginated: {{steps.query.output.isDone}}, {{steps.query.output.continueCursor}}

### Special Variables
- {{organizationId}} - Current organization
- {{executionId}} - Current workflow execution
- {{now}} - Current timestamp
- {{secrets.secretName}} - Encrypted secrets

### JEXL Filters
- Array: |length, |map("prop"), |filter(), |unique, |flatten
- String: |join(", ")
- Boolean: |hasOverlap(otherArray)
- Format: |formatList("template", "separator")`,

  // NOTE: 'all' is intentionally not included to prevent prompt overflow
  // The full WORKFLOW_SYNTAX_COMPACT is too long for agent context
  // Instead, agent should query specific categories as needed
};

/**
 * Get syntax reference by category
 */
export function getSyntaxReference(opts: { category: string }): {
  operation: 'get_syntax_reference';
  category: string;
  found: boolean;
  syntax: string;
} {
  const category = opts.category || 'all';
  const syntax = SYNTAX_MODULES[category];

  if (!syntax) {
    return {
      operation: 'get_syntax_reference',
      category,
      found: false,
      syntax: `Unknown category: ${category}. Available categories: ${Object.keys(SYNTAX_MODULES).join(', ')}`,
    };
  }

  return {
    operation: 'get_syntax_reference',
    category,
    found: true,
    syntax,
  };
}

/**
 * List available syntax categories
 */
export function listSyntaxCategories(): {
  operation: 'list_syntax_categories';
  categories: { key: string; description: string }[];
} {
  return {
    operation: 'list_syntax_categories',
    categories: [
      { key: 'quick_start', description: '⭐ START HERE: Decision tree and common mistakes to avoid' },
      { key: 'common_patterns', description: '⭐ Pattern skeletons: Entity Processing, Email, LLM Analysis, Data Sync, RAG' },
      { key: 'trigger', description: 'Trigger step configuration (manual, scheduled, webhook)' },
      { key: 'llm', description: 'LLM step configuration (AI agent with tools)' },
      { key: 'action', description: 'Action step types and parameters' },
      { key: 'condition', description: 'Condition step with JEXL expressions' },
      { key: 'loop', description: 'Loop step for iteration' },
      { key: 'email', description: 'Email sending pattern (conversation + approval)' },
      { key: 'entity_processing', description: 'One-at-a-time entity processing pattern' },
      { key: 'variables', description: 'Variable syntax and JEXL filters' },
    ],
  };
}
