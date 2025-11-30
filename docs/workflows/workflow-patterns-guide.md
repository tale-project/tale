# Workflow Patterns Guide

This guide provides comprehensive patterns for creating workflows in the system.

## Table of Contents

1. [Workflow Types](#workflow-types)
2. [Entity Processing Pattern](#entity-processing-pattern)
3. [Data Sync Pattern](#data-sync-pattern)
4. [Templating and Expressions](#templating-and-expressions)
5. [Common Action Patterns](#common-action-patterns)
6. [Best Practices](#best-practices)

---

## Workflow Types

### 1. Entity Processing Workflows

**Purpose**: Process entities one at a time (customers, products, conversations)

**Characteristics**:

- Process ONE entity per execution
- Use scheduled trigger for automated processing
- Track processed entities to avoid reprocessing
- Suitable for: customer analysis, product recommendations, conversation replies, status assessments

**When to Use**:

- When each entity requires significant processing (AI analysis, external API calls)
- When you want to avoid overwhelming external services
- When you need fine-grained control over processing rate
- When you want to track which entities have been processed

### 2. Data Sync Workflows

**Purpose**: Sync data from external sources (APIs, databases, files)

**Characteristics**:

- Process multiple items per execution
- Use pagination patterns
- Track sync state (cursors, timestamps, page info)
- Suitable for: Shopify sync, IMAP sync, website crawling, API data imports

**When to Use**:

- When syncing data from external APIs
- When processing large datasets in batches
- When you need to maintain sync state across executions

---

## Entity Processing Pattern

### Standard Structure

```typescript
{
  workflowConfig: {
    name: 'Entity Processing Workflow',
    workflowType: 'predefined',
    config: {
      timeout: 120000,
      variables: {
        organizationId: 'org_demo',
        workflowId: 'unique-workflow-id',
        backoffHours: 168, // 7 days
      },
    },
  },
  stepsConfig: [
    // Step 1: Scheduled Trigger
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'schedule',
        schedule: '0 */2 * * *', // Every 2 hours
        timezone: 'UTC',
      },
      nextSteps: { success: 'find_unprocessed' },
    },

    // Step 2: Find Unprocessed Entity
    {
      stepSlug: 'find_unprocessed',
      name: 'Find Unprocessed Entity',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          organizationId: '{{organizationId}}',
          tableName: 'customers', // or 'products', 'conversations'
          workflowId: '{{workflowId}}',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: { success: 'check_found' },
    },

    // Step 3: Check if Entity Found
    {
      stepSlug: 'check_found',
      name: 'Check if Entity Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_unprocessed.output.data.count > 0',
      },
      nextSteps: {
        true: 'extract_data',
        false: 'noop', // No entities to process
      },
    },

    // Step 4: Extract Entity Data
    {
      stepSlug: 'extract_data',
      name: 'Extract Entity Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            { name: 'entityId', value: '{{steps.find_unprocessed.output.data.documents[0]._id}}' },
            { name: 'entityData', value: '{{steps.find_unprocessed.output.data.documents[0]}}' },
          ],
        },
      },
      nextSteps: { success: 'process_entity' },
    },

    // Steps 5-N: Your Business Logic
    // ... (analyze, generate, update, etc.)

    // Step N+1: Record as Processed
    {
      stepSlug: 'record_processed',
      name: 'Record as Processed',
      stepType: 'action',
      order: 99, // Last step
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          organizationId: '{{organizationId}}',
          tableName: 'customers',
          workflowId: '{{workflowId}}',
          documentId: '{{entityId}}',
          documentCreationTime: '{{entityData._creationTime}}',
          metadata: {
            processedAt: '{{now}}',
            // Additional metadata
          },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
}
```

### Key Points

1. **Scheduled Trigger**: Use cron expression (e.g., `0 */2 * * *` for every 2 hours)
2. **Find Unprocessed**: Always check for unprocessed entities first
3. **Backoff Period**: Use `backoffHours` to avoid reprocessing recently processed entities
4. **Graceful Termination**: Use `noop` when no entities found
5. **Record Processed**: Always mark entity as processed at the end

---

## Data Sync Pattern

### Pagination Pattern

```typescript
{
  workflowConfig: {
    name: 'Data Sync Workflow',
    config: {
      variables: {
        organizationId: 'org_demo',
        pageSize: 50,
        maxPages: 20, // Safety limit
        currentPage: 0,
        nextPageInfo: null,
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger
    {
      stepSlug: 'start',
      stepType: 'trigger',
      order: 1,
      config: { type: 'manual' },
      nextSteps: { success: 'fetch_page' },
    },

    // Step 2: Fetch Page
    {
      stepSlug: 'fetch_page',
      stepType: 'action',
      order: 2,
      config: {
        type: 'shopify', // or other API
        parameters: {
          operation: 'list',
          resource: 'products',
          limit: '{{pageSize}}',
          page_info: '{{nextPageInfo}}',
        },
      },
      nextSteps: { success: 'loop_items' },
    },

    // Step 3: Loop Through Items
    {
      stepSlug: 'loop_items',
      stepType: 'loop',
      order: 3,
      config: {
        items: '{{steps.fetch_page.output.data.data}}',
        itemVariable: 'item',
      },
      nextSteps: {
        loop: 'process_item',
        done: 'check_next_page',
      },
    },

    // Step 4: Process Each Item
    {
      stepSlug: 'process_item',
      stepType: 'action',
      order: 4,
      config: {
        type: 'product',
        parameters: {
          operation: 'create',
          name: '{{loop.item.title}}',
          externalId: '{{loop.item.id}}',
        },
      },
      nextSteps: { success: 'loop_items' },
    },

    // Step 5: Check if More Pages
    {
      stepSlug: 'check_next_page',
      stepType: 'condition',
      order: 5,
      config: {
        expression: 'steps.fetch_page.output.data.pagination.hasNextPage == true && currentPage < maxPages',
      },
      nextSteps: {
        true: 'update_pagination',
        false: 'noop',
      },
    },

    // Step 6: Update Pagination Variables
    {
      stepSlug: 'update_pagination',
      stepType: 'action',
      order: 6,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            { name: 'currentPage', value: '{{currentPage + 1}}' },
            { name: 'nextPageInfo', value: '{{steps.fetch_page.output.data.pagination.nextPageInfo}}' },
          ],
        },
      },
      nextSteps: { success: 'fetch_page' }, // Loop back
    },
  ],
}
```

---

## Templating and Expressions

### Variable Interpolation

```javascript
// Simple variables
'{{organizationId}}';
'{{workflowId}}';

// Step outputs
'{{steps.fetch_data.output.data.customer.name}}';
'{{steps.find_unprocessed.output.data.documents[0]._id}}';

// Secrets (automatically decrypted)
'{{secrets.apiKey}}';
'{{secrets.imapPassword}}';

// Loop variables
'{{loop.item}}';
'{{loop.item.id}}';
'{{loop.state.iterations}}';

// Built-in variables
'{{now}}'; // Current ISO timestamp
'{{nowMs}}'; // Current timestamp in milliseconds
```

### JEXL Filters

```javascript
// Array operations
'{{items|length}}'; // Get array length
'{{items|map("id")}}'; // Extract 'id' from each item
'{{items|unique}}'; // Remove duplicates
'{{items|flatten}}'; // Flatten nested arrays
'{{items|concat(otherArray)}}'; // Concatenate arrays
'{{items|find("id", "123")}}'; // Find item by property

// String operations
'{{items|join(", ")}}'; // Join array with separator

// Formatting
'{{items|formatList("Name: {name}", "\\n")}}'; // Format array as list

// Boolean operations
'{{array1|hasOverlap(array2)}}'; // Check if arrays have common elements

// Complex expressions
'{{customers|map("metadata.subscriptions.data")|flatten|map("product_id")|unique}}';
```

### Condition Expressions

```javascript
// Comparison
'variable == "active"';
'steps.fetch.output.data.count > 0';
'count >= 5';

// Boolean logic
'status == "active" && count > 5';
'type == "A" || type == "B"';
'!(status == "inactive")';

// Array operations
'items|length > 0';
'steps.fetch.output.data.hasNextPage == true';

// Nested property access
'steps.query.output.data.customer.status == "active"';

// Complex conditions
'(metadata && metadata.subscriptions) ? metadata.subscriptions.data|length > 0 : false';
```

---

## Common Action Patterns

### workflow_processing_records

**Find Unprocessed Entity:**

```typescript
{
  stepType: 'action',
  config: {
    type: 'workflow_processing_records',
    parameters: {
      operation: 'find_unprocessed',
      organizationId: '{{organizationId}}',
      tableName: 'customers', // or 'products', 'conversations'
      workflowId: '{{workflowId}}',
      backoffHours: 168, // Don't reprocess for 7 days
    },
  },
}
```

**Find Unprocessed Open Conversation (special operation):**

```typescript
{
  stepType: 'action',
  config: {
    type: 'workflow_processing_records',
    parameters: {
      operation: 'find_unprocessed_open_conversation',
      organizationId: '{{organizationId}}',
      workflowId: '{{workflowId}}',
      backoffHours: '{{backoffHours}}',
    },
  },
}
```

**Record as Processed:**

```typescript
{
  stepType: 'action',
  config: {
    type: 'workflow_processing_records',
    parameters: {
      operation: 'record_processed',
      organizationId: '{{organizationId}}',
      tableName: 'customers',
      workflowId: '{{workflowId}}',
      documentId: '{{entityId}}',
      documentCreationTime: '{{entity._creationTime}}',
      metadata: {
        processedAt: '{{now}}',
        result: 'success',
      },
    },
  },
}
```

### set_variables

**Extract and Store Data:**

```typescript
{
  stepType: 'action',
  config: {
    type: 'set_variables',
    parameters: {
      variables: [
        { name: 'customerId', value: '{{steps.find.output.data.documents[0]._id}}' },
        { name: 'customerName', value: '{{steps.find.output.data.documents[0].name}}' },
        { name: 'apiKey', value: '{{encryptedKey}}', secure: true }, // Encrypted
      ],
    },
  },
}
```

**Note**: Use `secure: true` to automatically decrypt encrypted values and store them in secrets namespace.

### LLM Steps

**AI Analysis with Tools:**

```typescript
{
  stepType: 'llm',
  config: {
    name: 'Product Recommender', // REQUIRED
    // Model is configured globally via OPENAI_MODEL (required; no default model is provided)
    temperature: 0.3, // 0.0-1.0 (lower = more deterministic)
    maxTokens: 2000,
    maxSteps: 10, // For tool-using LLMs
    outputFormat: 'json', // or 'text'
    tools: ['customer_search', 'product_get', 'list_products'],
    systemPrompt: 'You are an expert product recommender...', // REQUIRED
    userPrompt: 'Customer: {{customerName}}\\nGenerate 5 recommendations.', // OPTIONAL but recommended
  },
}
```

**Key Points**:

- `name` and `systemPrompt` are REQUIRED
- Model selection: The model is configured globally via the `OPENAI_MODEL` environment variable (required; no default) and is not set per step.
- Use `systemPrompt` for role/instructions
- Use `userPrompt` for specific task with context
- `outputFormat: 'json'` requires LLM to return valid JSON
- `tools` array enables LLM to call tools for data fetching

### Approval Creation

**Create Approval Record:**

```typescript
{
  stepType: 'action',
  config: {
    type: 'approval',
    parameters: {
      operation: 'create_approval',
      organizationId: '{{organizationId}}',
      resourceType: 'conversations', // or 'product_recommendation'
      resourceId: '{{conversationId}}',
      priority: 'medium', // 'low', 'medium', 'high'
      description: 'Review AI-generated response',
      metadata: {
        emailBody: '{{steps.generate_content.output.data}}',
        customerId: '{{customerId}}',
      },
    },
  },
}
```

### Conditional Create/Update

**Query → Check → Create or Update:**

```typescript
// Step 1: Query existing
{
  stepSlug: 'query_entity',
  stepType: 'action',
  config: {
    type: 'product',
    parameters: {
      operation: 'query',
      organizationId: '{{organizationId}}',
      externalId: '{{externalId}}',
    },
  },
  nextSteps: { success: 'check_exists' },
}

// Step 2: Check if exists
{
  stepSlug: 'check_exists',
  stepType: 'condition',
  config: {
    expression: 'steps.query_entity.output.data.count > 0',
  },
  nextSteps: {
    true: 'update_entity',
    false: 'create_entity',
  },
}

// Step 3a: Update
{
  stepSlug: 'update_entity',
  stepType: 'action',
  config: {
    type: 'product',
    parameters: {
      operation: 'update',
      externalId: '{{externalId}}',
      updates: { /* ... */ },
    },
  },
  nextSteps: { success: 'next_step' },
}

// Step 3b: Create
{
  stepSlug: 'create_entity',
  stepType: 'action',
  config: {
    type: 'product',
    parameters: {
      operation: 'create',
      /* ... */
    },
  },
  nextSteps: { success: 'next_step' },
}
```

---

## Best Practices

### 1. Naming Conventions

- **stepSlug**: Use snake_case (e.g., `find_unprocessed_customer`)
- **name**: Use Title Case (e.g., `Find Unprocessed Customer`)
- **workflowId**: Use kebab-case (e.g., `customer-status-assessment`)
- **Variables**: Use camelCase (e.g., `currentCustomerId`)

### 2. Entity Processing

- **Always** use scheduled trigger for entity processing workflows
- **Always** use workflow_processing_records to track processed entities
- **Always** set appropriate backoffHours (e.g., 168 for 7 days)
- **Always** record entity as processed at the end
- Process ONE entity per execution

### 3. Error Handling

- Use `retryPolicy` in workflowConfig for transient failures
- Use condition steps to handle expected failure cases
- Use `noop` in nextSteps to gracefully end workflow
- Add descriptive error messages in metadata

### 4. Variable Management

- Extract complex data early with `set_variables`
- Use descriptive variable names
- Store sensitive data in secrets namespace with `secure: true`
- Access secrets with `{{secrets.variableName}}`

### 5. LLM Best Practices

- Use low temperature (0.0-0.3) for factual/analytical tasks
- Use higher temperature (0.7-1.0) for creative tasks
- Always specify `outputFormat` ('json' or 'text')
- Provide clear, detailed system prompts
- Use `maxSteps` when enabling tools
- Validate LLM output with condition steps

### 6. Performance

- Use indexes for database queries (defined in schema)
- Avoid nested loops when possible
- Use pagination for large datasets
- Set reasonable timeout values
- Use backoff periods to avoid overwhelming systems

### 7. Documentation

- Add comprehensive workflow description
- Document key features and flow
- Explain configuration variables
- Provide examples of expected inputs/outputs

### 8. Flow Control

- Use `noop` to end workflow gracefully
- Always define all possible nextSteps branches
- Avoid infinite loops (use counters and limits)
- Use condition steps for branching logic
- Test all branches thoroughly

---

## Complete Example: Customer Status Assessment

```typescript
import type { InlineWorkflowDefinition } from '../workflow/types/inline';

export const customerStatusWorkflow: InlineWorkflowDefinition = {
  workflowConfig: {
    name: 'Customer Status Assessment',
    description: 'Analyze customer status based on subscription data',
    workflowType: 'predefined',
    version: '1.0.0',
    config: {
      timeout: 120000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'assess-customer-status',
        backoffHours: 72,
      },
    },
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'schedule',
        schedule: '0 */2 * * *',
        timezone: 'UTC',
      },
      nextSteps: { success: 'find_customer' },
    },
    {
      stepSlug: 'find_customer',
      name: 'Find Unprocessed Customer',
      stepType: 'action',
      order: 2,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'find_unprocessed',
          organizationId: '{{organizationId}}',
          tableName: 'customers',
          workflowId: '{{workflowId}}',
          backoffHours: '{{backoffHours}}',
        },
      },
      nextSteps: { success: 'check_found' },
    },
    {
      stepSlug: 'check_found',
      name: 'Check if Customer Found',
      stepType: 'condition',
      order: 3,
      config: {
        expression: 'steps.find_customer.output.data.count > 0',
      },
      nextSteps: {
        true: 'extract_data',
        false: 'noop',
      },
    },
    {
      stepSlug: 'extract_data',
      name: 'Extract Customer Data',
      stepType: 'action',
      order: 4,
      config: {
        type: 'set_variables',
        parameters: {
          variables: [
            {
              name: 'customerId',
              value: '{{steps.find_customer.output.data.documents[0]._id}}',
            },
            {
              name: 'customerName',
              value: '{{steps.find_customer.output.data.documents[0].name}}',
            },
          ],
        },
      },
      nextSteps: { success: 'analyze_status' },
    },
    {
      stepSlug: 'analyze_status',
      name: 'Analyze Status',
      stepType: 'llm',
      order: 5,
      config: {
        name: 'Status Analyzer',
        model: 'gpt-4o',
        temperature: 0.3,
        maxTokens: 500,
        outputFormat: 'json',
        systemPrompt:
          'Analyze customer status. Return JSON: {"status": "active|churned|potential"}',
        userPrompt: 'Customer: {{customerName}}',
      },
      nextSteps: { success: 'update_status' },
    },
    {
      stepSlug: 'update_status',
      name: 'Update Customer Status',
      stepType: 'action',
      order: 6,
      config: {
        type: 'customer',
        parameters: {
          operation: 'update',
          customerId: '{{customerId}}',
          updates: {
            status: '{{steps.analyze_status.output.data.status}}',
          },
        },
      },
      nextSteps: { success: 'record_processed' },
    },
    {
      stepSlug: 'record_processed',
      name: 'Record as Processed',
      stepType: 'action',
      order: 7,
      config: {
        type: 'workflow_processing_records',
        parameters: {
          operation: 'record_processed',
          organizationId: '{{organizationId}}',
          tableName: 'customers',
          workflowId: '{{workflowId}}',
          documentId: '{{customerId}}',
          documentCreationTime:
            '{{steps.find_customer.output.data.documents[0]._creationTime}}',
          metadata: { processedAt: '{{now}}' },
        },
      },
      nextSteps: { success: 'noop' },
    },
  ],
};
```

This example demonstrates all key patterns:

- Scheduled trigger for automated processing
- workflow_processing_records for tracking
- Condition-based branching
- Variable extraction
- LLM integration
- Entity update
- Graceful termination
