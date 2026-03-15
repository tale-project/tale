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

**find_unprocessed:**
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
- backoffHours: minimum hours before reprocessing the same record (e.g., 168 = 7 days)
- filterExpression: JEXL syntax for filtering candidates

**record_processed:**
\`\`\`json
{
  "type": "workflow_processing_records",
  "parameters": {
    "operation": "record_processed",
    "tableName": "customers",
    "recordId": "{{steps.find_customer.output.data._id}}",
    "recordCreationTime": "{{steps.find_customer.output.data._creationTime}}"
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

**Email outbound (channel: email):**
\`\`\`json
{
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
\`\`\`
Required metadata: emailSubject, emailBody, customerEmail
Optional metadata: emailPreview, emailCc, emailBcc
Note: there is no direct "send_email" action. Create a conversation with email metadata, then create an approval to trigger the send.

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

  output: `## Output Step (stepType: 'output')

Config: { outputMapping?: Record<string, string> }
NextSteps: {} (empty — output steps have no outgoing connections)

The output step is optional. It defines what the workflow returns as its final output.
If omitted, the workflow output falls back to sanitized variables (secrets and system fields stripped).
Use outputMapping to select which variables or step outputs to include. Values support {{...}} template syntax with full type preservation.

**Output with Mapping:**
\`\`\`json
{
  "stepSlug": "finish",
  "name": "Return Results",
  "stepType": "output",

  "config": {
    "outputMapping": {
      "analysis": "{{steps.analyze.output.data}}",
      "customerId": "{{customerId}}",
      "processedAt": "{{now}}"
    }
  },
  "nextSteps": {}
}
\`\`\`

**Output with No Mapping (side-effect-only workflow):**
\`\`\`json
{
  "stepSlug": "finish",
  "name": "Done",
  "stepType": "output",

  "config": {},
  "nextSteps": {}
}
\`\`\`

**IMPORTANT:**
- outputMapping values are {{...}} templates — they preserve types (objects, arrays, numbers stay as-is)
- Do NOT reference secrets in outputMapping (e.g., {{secrets.apiKey}}) — this leaks sensitive data
- If outputMapping is empty or omitted, the workflow output is null
- nextSteps MUST be empty: {}`,

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

/**
 * Get all syntax modules combined
 */
export function getAllSyntax(): {
  found: boolean;
  syntax: string;
} {
  const combined = Object.values(SYNTAX_MODULES).join('\n\n---\n\n');
  return { found: true, syntax: combined };
}

// Category descriptions - kept in sync with SYNTAX_MODULES keys
const SYNTAX_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  start:
    'Start step configuration (workflow entry point with optional inputSchema)',
  llm: 'LLM step configuration (AI agent with tools)',
  action:
    'Action step types and parameters (workflow_processing_records, customer, conversation, approval, set_variables, integration)',
  condition: 'Condition step with JEXL expressions',
  loop: 'Loop step for iteration',
  output: 'Output step configuration (workflow output via outputMapping)',
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
