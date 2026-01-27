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
- start: Workflow entry point (optional inputSchema for declaring inputs)
- action: CRUD operations, set_variables, integrations, approvals
- llm: AI decision-making and content generation (requires name + systemPrompt)
- condition: JEXL expression branching (nextSteps: true/false)
- loop: Iterate over arrays (for data sync, NOT entity processing)

**NEXT STEPS:**
1. Get pattern details: workflow_examples(operation='get_syntax_reference', category='common_patterns')
2. Get step syntax: workflow_examples(operation='get_syntax_reference', category='start|llm|action|condition|loop')`,

  common_patterns: `## COMMON WORKFLOW PATTERNS

### Pattern 1: Entity Processing (Most Common)
Process customers/products/conversations one at a time. Each execution handles ONE entity.

**Structure:** start → find_unprocessed → condition → process → record_processed → noop

**Skeleton:**
\`\`\`json
[
  { "stepSlug": "start", "stepType": "start", "config": {}, "nextSteps": { "success": "find_entity" } },
  { "stepSlug": "find_entity", "stepType": "action", "config": { "type": "workflow_processing_records", "parameters": { "operation": "find_unprocessed", "tableName": "customers", "backoffHours": "{{backoffHours}}", "filterExpression": "status == \\"active\\"" } }, "nextSteps": { "success": "check_found" } },
  { "stepSlug": "check_found", "stepType": "condition", "config": { "expression": "steps.find_entity.output.data != null" }, "nextSteps": { "true": "extract_data", "false": "noop" } },
  { "stepSlug": "extract_data", "stepType": "action", "config": { "type": "set_variables", "parameters": { "variables": [{ "name": "entityId", "value": "{{steps.find_entity.output.data._id}}" }] } }, "nextSteps": { "success": "process" } },
  { "stepSlug": "process", "stepType": "llm", "config": { "name": "Process Entity", "systemPrompt": "You are an analyst...", "userPrompt": "Analyze: {{steps.find_entity.output.data}}", "outputFormat": "json" }, "nextSteps": { "success": "record_processed" } },
  { "stepSlug": "record_processed", "stepType": "action", "config": { "type": "workflow_processing_records", "parameters": { "operation": "record_processed", "tableName": "customers", "recordId": "{{entityId}}" } }, "nextSteps": { "success": "noop" } }
]
\`\`\`

### Pattern 2: Email Sending
Create conversation with draftMessage to automatically create approval. Email sends when approved.

**Structure:** ... → create_conversation (with draftMessage) → record_processed → noop

**Key Step:**
\`\`\`json
{ "stepSlug": "create_conversation", "stepType": "action", "config": { "type": "conversation", "parameters": { "operation": "create", "customerId": "{{customerId}}", "subject": "{{emailSubject}}", "channel": "email", "draftMessage": { "priority": "medium", "description": "Review email before sending", "content": "{{emailBody}}", "subject": "{{emailSubject}}", "recipients": ["{{customerEmail}}"], "metadata": { "customerName": "{{customerName}}" } } } }, "nextSteps": { "success": "record_processed" } }
\`\`\`

### Pattern 3: LLM Analysis + Action
AI analyzes data, outputs JSON, then condition branches based on result.

**Structure:** ... → compose_prompts → llm_analyze → condition → action_based_on_result

**LLM Step with JSON Output:**
\`\`\`json
{ "stepSlug": "analyze", "stepType": "llm", "config": { "name": "Analyzer", "systemPrompt": "You are an expert analyst. Analyze the data and return a structured decision.", "userPrompt": "Analyze: {{data}}", "maxTokens": 2000, "maxSteps": 10, "outputFormat": "json", "outputSchema": { "type": "object", "properties": { "decision": { "type": "string", "enum": ["approve", "reject", "review"] }, "reasoning": { "type": "string" } }, "required": ["decision", "reasoning"] }, "tools": ["rag_search", "customer_read", "product_read"] }, "nextSteps": { "success": "check_decision" } }
\`\`\`

### Pattern 4: Data Sync with Pagination
Sync external data sources (Shopify, IMAP) with cursor-based pagination.

**Structure:** start → fetch_page → loop_items → upsert_each → check_next_page → [true] update_cursor → fetch_page

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

**Structure:** start → find_unprocessed → condition → prepare_content → upload_to_rag → update_metadata → record_processed

**RAG Upload Action:**
\`\`\`json
{ "stepSlug": "upload_to_rag", "stepType": "action", "config": { "type": "rag", "parameters": { "operation": "upload", "content": "{{documentContent}}", "metadata": { "sourceId": "{{documentId}}", "sourceType": "document" } } }, "nextSteps": { "success": "record_processed" } }
\`\`\``,

  start: `## Start Step (stepType: 'start')

Config: { inputSchema?: { properties: { [name]: { type, description? } }, required?: string[] } }
NextSteps: { success: 'next_step_slug' }

The start step defines the workflow entry point and optionally declares an input schema.
Trigger sources (schedules, webhooks, API keys, events) are configured separately — not in step config.

**Start with Input Schema:**
\`\`\`json
{
  "inputSchema": {
    "properties": {
      "customerId": { "type": "string", "description": "Customer to process" },
      "priority": { "type": "number", "description": "Processing priority" }
    },
    "required": ["customerId"]
  }
}
\`\`\`

**Minimal Start (no input schema):**
\`\`\`json
{}
\`\`\``,

  llm: `## LLM Step (stepType: 'llm')

Config: { name (REQUIRED), systemPrompt (REQUIRED), userPrompt?, tools?: string[], outputFormat?: 'text'|'json', outputSchema?, contextVariables? }
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
  "tools": ["customer_read", "product_read"],
  "outputFormat": "json"
}
\`\`\`

**Available Tools for LLM Steps:**
- customer_read: Fetch customer by ID, email, or list all (operation: get_by_id, get_by_email, list)
- product_read: Fetch product by ID or list all (operation: get_by_id, list)
- rag_search: Search knowledge base`,

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
Operations: create, get_by_id, query_messages, query_latest_message_by_delivery_state, update, create_from_email, create_from_sent_email

**create with draftMessage (recommended for outbound messages):**
\`\`\`json
{
  "type": "conversation",
  "parameters": {
    "operation": "create",
    "channel": "email",
    "subject": "{{emailSubject}}",
    "draftMessage": {
      "priority": "medium",
      "description": "Review before sending",
      "content": "{{emailBody}}",
      "subject": "{{emailSubject}}",
      "recipients": ["{{customerEmail}}"],
      "ccRecipients": ["{{ccEmail}}"],
      "metadata": { "customerName": "{{customerName}}" }
    }
  }
}
\`\`\`
- direction is auto-set to 'outbound' when draftMessage is provided
- Creates conversation + pending approval in one step
- Works for any channel (email, sms, whatsapp)

### approval
Operation: create_approval (use only when you need separate approval step)
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

Workflows DO NOT have a direct "send_email" action. Use conversation with draftMessage:

### Recommended: Single Step with draftMessage
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
      "draftMessage": {
        "priority": "medium",
        "description": "Review email before sending",
        "content": "{{emailBody}}",
        "subject": "{{emailSubject}}",
        "recipients": ["{{customerEmail}}"],
        "ccRecipients": ["{{ccEmail}}"],
        "bccRecipients": ["{{bccEmail}}"],
        "metadata": {
          "customerName": "{{customerName}}",
          "customerId": "{{customerId}}"
        }
      }
    }
  }
}
\`\`\`

### How It Works
- draftMessage automatically creates a pending approval
- direction is auto-set to 'outbound'
- Approval appears in dashboard for human review
- When approved, system automatically sends the email
- Conversation tracks the email thread for replies

### draftMessage Fields
**Required:**
- content: Email body (HTML or Markdown)
- recipients: Array of recipient email addresses
- priority: 'low' | 'medium' | 'high' | 'urgent'

**Optional:**
- subject: Email subject line
- ccRecipients: CC recipient addresses
- bccRecipients: BCC recipient addresses
- description: Approval description
- dueDate: Approval due date (timestamp)
- metadata: Additional data (customerName, etc.)

**Reference:** Use workflow_examples(operation='get_syntax_reference', category='common_patterns') for the email sending pattern`,

  entity_processing: `## ENTITY PROCESSING PATTERN (One-at-a-Time)

For workflows that process multiple entities (customers, products, conversations):

### Standard Structure
\`\`\`
Step 1: Scheduled Start (e.g., "0 */2 * * *")
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

  workflow_config: `## WORKFLOW CONFIG (workflowConfig.config)

The optional \`config\` field on \`workflowConfig\` supports these fields:

### timeout (number, optional)
Workflow timeout in milliseconds. The workflow execution will be aborted if it exceeds this duration.
\`\`\`json
{ "timeout": 120000 }
\`\`\`

### retryPolicy (object, optional)
Default retry policy applied to action steps.
\`\`\`json
{ "retryPolicy": { "maxRetries": 3, "backoffMs": 2000 } }
\`\`\`

### variables (object, optional)
Initial workflow-level variables accessible to all steps via \`{{variableName}}\`.
\`organizationId\` is automatically injected — no need to set it.
\`\`\`json
{ "variables": { "backoffHours": 72, "defaultStatus": "active" } }
\`\`\`

### Full Example
\`\`\`json
{
  "workflowConfig": {
    "name": "My Workflow",
    "description": "Example with config",
    "config": {
      "timeout": 120000,
      "retryPolicy": { "maxRetries": 2, "backoffMs": 1000 },
      "variables": {
        "backoffHours": 72,
        "conversationStatus": "open"
      }
    }
  }
}
\`\`\``,

  variables: `## VARIABLE SYNTAX

### Simple Variables
- {{variableName}}
- {{customer.email}}
- {{items|first}} (safe first element)

### Step Output Access
Action outputs are wrapped: steps.{step_slug}.output.data
- Single entity: {{steps.get_customer.output.data._id}}
- First array item: {{steps.query.output.data|first}} (use |first instead of [0] — [0] crashes if data is undefined)
- Array length: {{steps.query.output.data|length}}
- Paginated: {{steps.query.output.isDone}}, {{steps.query.output.continueCursor}}

### Special Variables
- {{organizationId}} - Current organization
- {{executionId}} - Current workflow execution
- {{now}} - Current timestamp
- {{secrets.secretName}} - Encrypted secrets

### JEXL Filters
- Array: |length, |first, |last, |map("prop"), |filter(), |unique, |flatten, |slice(start, end), |sort("field", "asc"), |reverse
- String: |join(", "), |upper, |lower, |trim
- Boolean: |hasOverlap(otherArray)
- Type: |string, |number, |boolean, |parseJSON
- Date: |isoDate, |parseDate, |daysAgo, |hoursAgo, |minutesAgo, |isBefore(date), |isAfter(date)
- Format: |formatList("template", "separator")
- Lookup: |find("field", value), |filterBy("field", value)

**IMPORTANT:** Use |first instead of [0] when the array might be undefined (e.g., branching paths where only one step runs). [0] will throw an error on undefined arrays, while |first safely returns undefined.`,

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
  const category = opts.category;
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

// Category descriptions - kept in sync with SYNTAX_MODULES keys
const SYNTAX_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  quick_start: '⭐ START HERE: Decision tree and common mistakes to avoid',
  common_patterns:
    '⭐ Pattern skeletons: Entity Processing, Email, LLM Analysis, Data Sync, RAG',
  start:
    'Start step configuration (workflow entry point with optional inputSchema)',
  llm: 'LLM step configuration (AI agent with tools)',
  action: 'Action step types and parameters',
  condition: 'Condition step with JEXL expressions',
  loop: 'Loop step for iteration',
  email: 'Email sending pattern (conversation + approval)',
  entity_processing: 'One-at-a-time entity processing pattern',
  workflow_config:
    'Workflow-level config: timeout, retryPolicy, and initial variables',
  variables: 'Variable syntax and JEXL filters',
};

/**
 * List available syntax categories
 * Dynamically derived from SYNTAX_MODULES to prevent drift
 */
export function listSyntaxCategories(): {
  operation: 'list_syntax_categories';
  categories: { key: string; description: string }[];
} {
  return {
    operation: 'list_syntax_categories',
    categories: Object.keys(SYNTAX_MODULES).map((key) => ({
      key,
      description:
        SYNTAX_CATEGORY_DESCRIPTIONS[key] ?? 'No description available',
    })),
  };
}
