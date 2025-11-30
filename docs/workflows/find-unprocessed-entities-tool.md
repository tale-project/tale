# find_unprocessed_entities Tool

## Overview

The `find_unprocessed_entities` tool is a specialized Convex tool that finds entities (currently only customers) that haven't been processed by a specific workflow within a given time window.

## Purpose

This tool enables workflows to automatically discover entities that need processing, based on workflow-specific tracking metadata. It's the foundation of the auto-processing pattern for agent orchestration workflows.

## How It Works

### Tracking Mechanism

Each workflow tracks its processing history in the entity's metadata:

```typescript
// Customer metadata structure
{
  metadata: {
    workflows: {
      "assess-customer-status": {
        lastProcessedAt: "2024-01-15T10:30:00Z",
        lastExecutionId: "exec_123"
      },
      "send-churn-survey": {
        lastProcessedAt: "2024-01-10T08:00:00Z",
        lastExecutionId: "exec_456"
      }
    }
  }
}
```

### Search Logic

The tool finds entities where:

1. `metadata.workflows.{workflowId}.lastProcessedAt` is **missing** (never processed), OR
2. `metadata.workflows.{workflowId}.lastProcessedAt` is **older** than `daysBack` days ago

## Tool Signature

```typescript
find_unprocessed_entities({
  entityType: 'customer', // Currently only 'customer' is supported
  workflowId: string, // e.g., 'assess-customer-status'
  daysBack: number, // Default: 3 days
  limit: number, // Default: 1, max: 100
});
```

### Parameters

| Parameter    | Type         | Required | Default      | Description                                                  |
| ------------ | ------------ | -------- | ------------ | ------------------------------------------------------------ |
| `entityType` | `'customer'` | No       | `'customer'` | Type of entity to search (only customer supported currently) |
| `workflowId` | `string`     | Yes      | -            | Workflow ID to check processing history for                  |
| `daysBack`   | `number`     | No       | `3`          | Number of days to look back (1-365)                          |
| `limit`      | `number`     | No       | `1`          | Maximum number of entities to return (1-100)                 |

### Return Value

```typescript
{
  entities: Array<Doc<'customers'>>,  // Array of customer documents
  count: number,                       // Number of entities found
  searchCriteria: {
    entityType: string,
    workflowId: string,
    daysBack: number,
    cutoffDate: string  // ISO timestamp
  }
}
```

## Usage in Workflows

### Example: Customer Finder Agent

```typescript
{
  stepSlug: 'customer_finder_agent',
  stepType: 'llm',
  config: {
    llmNode: {
      systemPrompt: `You are a Customer Finder Agent.

Use find_unprocessed_entities tool to find ONE customer that needs processing.

If count > 0: Return the first customer from entities array
If count = 0: Return termination signal`,

      userPrompt: `Find ONE customer for workflow: {{workflowId}}
Days back: {{daysBack}}`,

      tools: ['find_unprocessed_entities'],
    },
  },
}
```

### Example AI Usage

**AI Call:**

```json
{
  "tool": "find_unprocessed_entities",
  "args": {
    "entityType": "customer",
    "workflowId": "assess-customer-status",
    "daysBack": 3,
    "limit": 1
  }
}
```

**Tool Response (customer found):**

```json
{
  "entities": [
    {
      "_id": "cust_123",
      "name": "John Doe",
      "email": "john@example.com",
      "metadata": {
        "workflows": {
          "other-workflow": {
            "lastProcessedAt": "2024-01-10T00:00:00Z"
          }
        }
      }
    }
  ],
  "count": 1,
  "searchCriteria": {
    "entityType": "customer",
    "workflowId": "assess-customer-status",
    "daysBack": 3,
    "cutoffDate": "2024-01-12T00:00:00Z"
  }
}
```

**Tool Response (no customers found):**

```json
{
  "entities": [],
  "count": 0,
  "searchCriteria": {
    "entityType": "customer",
    "workflowId": "assess-customer-status",
    "daysBack": 3,
    "cutoffDate": "2024-01-12T00:00:00Z"
  }
}
```

## Implementation Details

### Files Created

1. **Tool Definition**

   - `convex/workflow/nodes/llm/tools/convex_tools/find_unprocessed_entities.ts`
   - Defines the tool interface and validation

2. **Query Implementation**

   - `convex/customer_queries/find_unprocessed.ts`
   - Implements the actual database query logic

3. **Tool Registration**
   - Updated `convex/workflow/nodes/llm/tools/tool_registry.ts`
   - Registered the tool in the global registry

### Query Logic

```typescript
// Simplified query logic
export const findUnprocessed = internalQuery({
  handler: async (ctx, args) => {
    const { organizationId, workflowId, cutoffTimestamp, limit } = args;

    // Get all customers for organization
    const allCustomers = await ctx.db
      .query('customers')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', organizationId),
      )
      .collect();

    // Filter based on workflow processing status
    const unprocessed = [];
    for (const customer of allCustomers) {
      const lastProcessedAt =
        customer.metadata?.workflows?.[workflowId]?.lastProcessedAt;

      if (!lastProcessedAt || lastProcessedAt < cutoffTimestamp) {
        unprocessed.push(customer);
        if (unprocessed.length >= limit) break;
      }
    }

    return { entities: unprocessed, count: unprocessed.length };
  },
});
```

## Benefits

1. **Workflow-Specific Tracking**

   - Each workflow tracks its own processing independently
   - No conflicts between different workflows

2. **Flexible Time Windows**

   - Configurable `daysBack` parameter
   - Prevents over-processing or under-processing

3. **Efficient Discovery**

   - Finds entities that need work automatically
   - No manual intervention required

4. **Audit Trail**
   - Complete history of when each workflow processed each entity
   - Includes execution IDs for debugging

## Best Practices

1. **Use Descriptive Workflow IDs**

   ```typescript
   workflowId: 'assess-customer-status'; // ✅ Good
   workflowId: 'workflow1'; // ❌ Bad
   ```

2. **Set Appropriate Time Windows**

   ```typescript
   daysBack: 1; // For frequent checks (daily)
   daysBack: 7; // For weekly reviews
   daysBack: 30; // For monthly analysis
   ```

3. **Limit Results Appropriately**

   ```typescript
   limit: 1; // ✅ For one-at-a-time processing
   limit: 10; // ✅ For batch processing
   limit: 100; // ⚠️ Maximum allowed
   ```

4. **Always Update Processing Metadata**
   After processing an entity, always update:
   ```typescript
   metadata.workflows.{workflowId}.lastProcessedAt = new Date().toISOString()
   metadata.workflows.{workflowId}.lastExecutionId = executionId
   ```

## Future Enhancements

### Planned Features

1. **Support for More Entity Types**

   - Products
   - Subscriptions
   - Orders
   - Custom entities

2. **Advanced Filtering**

   - Additional filter criteria beyond time
   - Status-based filtering
   - Tag-based filtering

3. **Performance Optimization**

   - Index-based queries for large datasets
   - Pagination support
   - Caching strategies

4. **Batch Processing**
   - Process multiple entities in one execution
   - Configurable batch sizes
   - Progress tracking

## Troubleshooting

### No Entities Found

**Problem:** Tool always returns `count: 0`

**Solutions:**

1. Check if entities exist in the database
2. Verify `workflowId` matches exactly
3. Check if `daysBack` is too short
4. Verify `organizationId` is correct

### Too Many Entities Found

**Problem:** Tool returns many entities when you expect few

**Solutions:**

1. Reduce `daysBack` value
2. Ensure processing metadata is being updated correctly
3. Check for duplicate workflow executions

### Type Errors

**Problem:** TypeScript errors about missing properties

**Solutions:**

1. Run `npx convex dev` to regenerate types
2. Ensure all files are saved
3. Restart TypeScript server in IDE

## Related Documentation

- [Auto-Processing Pattern](./auto-processing-pattern.md)
- [Workflow Termination Protocol](../convex/workflow/nodes/llm/types/workflow_termination.ts)
- [Workflow Types](./workflow-types.md)
