# Auto-Processing Pattern for Agent Orchestration Workflows

## Overview

This pattern enables workflows to automatically find and process entities (customers, products, etc.) one at a time, with intelligent termination when no work is needed.

## Key Concepts

### 1. Workflow-Specific Processing Tracking

Each workflow tracks its own processing history independently using `workflowId`:

```typescript
// Customer metadata structure
{
  metadata: {
    workflows: {
      "assess-customer-status": {
        lastProcessedAt: "2024-01-15T10:30:00Z",
        lastExecutionId: "exec_123",
        processCount: 5
      },
      "send-churn-survey": {
        lastProcessedAt: "2024-01-10T08:00:00Z",
        lastExecutionId: "exec_456",
        processCount: 2
      }
    }
  }
}
```

**Benefits:**

- ✅ Same customer can be processed by different workflows independently
- ✅ Each workflow has its own processing schedule
- ✅ No conflicts between different workflow types
- ✅ Clear audit trail per workflow

### 2. One Entity Per Execution

Each workflow execution processes exactly ONE entity:

- **Scheduled trigger** runs periodically (e.g., every 5 minutes)
- **Finder Agent** searches for ONE unprocessed entity
- **Processing Agents** analyze and update that entity
- **Update Agent** marks entity as processed

**Benefits:**

- ✅ Simple, predictable execution
- ✅ Easy to debug and monitor
- ✅ Natural rate limiting
- ✅ Clear conversation context (one entity per thread)

### 3. Intelligent Workflow Termination

Workflows can terminate early when no work is needed:

```typescript
// Termination signal from Finder Agent
{
  "shouldTerminate": true,
  "reason": "No customers found that haven't been processed in the last 3 days",
  "terminationType": "NO_DATA_FOUND",
  "metadata": {
    "workflowId": "assess-customer-status",
    "daysBack": 3,
    "searchTimestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Benefits:**

- ✅ No wasted processing when no work is needed
- ✅ Clear audit trail of why workflow terminated
- ✅ AI-driven decision making
- ✅ Automatic resource optimization

## Workflow Structure

### Standard Pattern

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Scheduled Trigger (every N minutes)                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Finder Agent                                             │
│    - Search for ONE unprocessed entity                      │
│    - Check: metadata.workflows.{workflowId}.lastProcessedAt │
│    - If found → Return entity data                          │
│    - If NOT found → Return termination signal               │
└────────────┬───────────────────────────────┬────────────────┘
             │                               │
             │ (entity found)                │ (no entity)
             ▼                               ▼
┌────────────────────────────┐    ┌─────────────────────────┐
│ 3. Analyzer Agent          │    │ 5. Finish               │
│    - Analyze entity        │    │    (workflow terminated)│
│    - Determine action      │    └─────────────────────────┘
└────────────┬───────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Update Agent                                             │
│    - Perform updates                                        │
│    - Mark as processed:                                     │
│      metadata.workflows.{workflowId}.lastProcessedAt = now  │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Finish                                                   │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Example

### Workflow Configuration

```typescript
export default {
  workflowConfig: {
    name: 'Single Customer Status Assessment',
    description:
      'Automatically find and analyze one customer that needs status assessment',
    workflowType: 'agent_orchestration' as const,
    config: {
      timeout: 120000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
      variables: {
        organizationId: 'org_demo',
        workflowId: 'assess-customer-status', // Used for tracking
        daysBack: 3, // Process customers not processed in last 3 days
      },
    },
  },
  stepsConfig: [
    // Step 1: Scheduled Trigger
    {
      stepSlug: 'start',
      stepType: 'trigger',
      config: {
        type: 'scheduled',
        schedule: '*/5 * * * *', // Every 5 minutes
      },
      nextSteps: { default: 'customer_finder_agent' },
    },

    // Step 2: Finder Agent
    {
      stepSlug: 'customer_finder_agent',
      stepType: 'llm',
      config: {
        llmNode: {
          systemPrompt: `Find ONE customer not processed by {{workflowId}} in last {{daysBack}} days.
          
If no customer found, return termination signal:
{
  "shouldTerminate": true,
  "reason": "...",
  "terminationType": "NO_DATA_FOUND"
}`,
          tools: ['customer_search'],
        },
      },
      nextSteps: {
        success: 'status_analyzer_agent',
        terminate: 'finish', // Auto-route on termination
      },
    },

    // Step 3: Analyzer Agent
    {
      stepSlug: 'status_analyzer_agent',
      stepType: 'llm',
      config: {
        llmNode: {
          systemPrompt: 'Analyze customer status...',
          tools: [],
        },
      },
      nextSteps: { success: 'update_executor_agent' },
    },

    // Step 4: Update Agent
    {
      stepSlug: 'update_executor_agent',
      stepType: 'llm',
      config: {
        llmNode: {
          systemPrompt: `Update customer and mark as processed:
- metadata.workflows.{{workflowId}}.lastProcessedAt = now
- metadata.workflows.{{workflowId}}.lastExecutionId = {{executionId}}`,
          tools: ['customer_update'],
        },
      },
      nextSteps: { success: 'finish' },
    },

    // Step 5: Finish
    {
      stepSlug: 'finish',
      stepType: 'trigger',
      config: { type: 'manual' },
      nextSteps: {},
    },
  ],
};
```

## Finder Agent Prompt Template

```typescript
systemPrompt: `You are a Finder Agent. Find ONE entity that needs processing.

WORKFLOW TERMINATION PROTOCOL:
If NO entities need processing, return:
{
  "shouldTerminate": true,
  "reason": "No entities found that haven't been processed by workflow '{{workflowId}}' in the last {{daysBack}} days",
  "terminationType": "NO_DATA_FOUND",
  "metadata": {
    "workflowId": "{{workflowId}}",
    "daysBack": {{daysBack}},
    "searchTimestamp": "ISO date"
  }
}

Search criteria:
1. Find entities where metadata.workflows.{{workflowId}}.lastProcessedAt is:
   - Missing (never processed), OR
   - Older than {{daysBack}} days ago
2. Return ONLY ONE entity (first eligible)
3. If none found, return termination signal

SUCCESS Response:
{
  "entityId": "...",
  "entityData": {...},
  "lastProcessedAt": "ISO date or null",
  "neverProcessed": boolean
}`,

userPrompt: `Find ONE entity for workflow: {{workflowId}}
Days back: {{daysBack}}
Metadata path: workflows.{{workflowId}}.lastProcessedAt`
```

## Update Agent Prompt Template

```typescript
systemPrompt: `You are an Update Agent. Update entity and mark as processed.

CRITICAL: After updating, mark as processed:
- metadata.workflows.{{workflowId}}.lastProcessedAt = current ISO timestamp
- metadata.workflows.{{workflowId}}.lastExecutionId = "{{executionId}}"

This prevents duplicate processing within the time window.`,

userPrompt: `Update the entity and mark as processed by workflow: {{workflowId}}
Execution ID: {{executionId}}`
```

## Benefits of This Pattern

### 1. Scalability

- Processes entities gradually over time
- Natural rate limiting (one per execution)
- No overwhelming database queries

### 2. Reliability

- Clear processing state per workflow
- No duplicate processing within time window
- Easy to retry failed executions

### 3. Observability

- Each execution has clear audit trail
- Easy to see which entities were processed when
- Termination reasons are logged

### 4. Flexibility

- Different workflows can process same entities independently
- Each workflow has its own schedule and rules
- Easy to adjust processing frequency

### 5. Resource Efficiency

- Auto-terminates when no work needed
- No wasted processing cycles
- Optimal use of AI agent resources

## Common Use Cases

1. **Customer Status Assessment**

   - Find customers needing status update
   - Analyze subscription patterns
   - Update status and mark as processed

2. **Churn Prevention**

   - Find at-risk customers
   - Generate personalized retention offers
   - Track outreach attempts

3. **Product Recommendations**

   - Find customers eligible for recommendations
   - Generate AI-powered suggestions
   - Track recommendation history

4. **Data Quality Checks**
   - Find entities with incomplete data
   - Validate and enrich data
   - Mark as validated

## Best Practices

1. **Use Descriptive Workflow IDs**

   - Use kebab-case: `assess-customer-status`
   - Make it clear what the workflow does
   - Keep it unique across all workflows

2. **Set Appropriate Time Windows**

   - Too short: Excessive processing
   - Too long: Stale data
   - Typical: 1-7 days depending on use case

3. **Handle Termination Gracefully**

   - Always provide clear termination reasons
   - Include search metadata for debugging
   - Log termination events

4. **Track Processing Metadata**

   - Always update `lastProcessedAt`
   - Include `lastExecutionId` for audit trail
   - Optionally track `processCount`

5. **Test Termination Logic**
   - Verify termination signal is detected
   - Ensure workflow ends gracefully
   - Check audit logs are complete
