# Workflow Types

## Overview

The workflow system currently supports one active type of workflow:

1. **Predefined Workflows** - Developer-defined workflows for platform integrations and data operations

A previous design also included **Dynamic Orchestration Workflows** (user-defined or AI-generated workflows for agent collaboration). That feature has been removed from the codebase; the remaining references below are kept only for historical context and should not be treated as current behavior.

## Important: Pure Agent Orchestration vs Hybrid Workflows

### Pure Agent Orchestration Workflows

**Structure:**

- **1 Trigger node** (defines when to run)
- **Multiple LLM nodes** (each representing a different agent role)
- **No action/condition/loop nodes** (agents handle all logic)

**Characteristics:**

- All LLM nodes share the same threadId
- Each agent builds on previous agents' insights
- Focus on ONE object per execution (e.g., one customer)
- Agents collaborate in sequence like a team

**Example:** Single Customer Churn Analysis

```
Trigger → Data Collector Agent → Behavior Analyst Agent → Churn Predictor Agent → Action Recommender Agent
```

### Hybrid Workflows (Currently Marked as dynamic_orchestration)

**Structure:**

- Mix of trigger, action, condition, loop, and LLM nodes
- May process multiple objects (pagination, batching)
- LLM nodes used for specific analysis tasks

**Note:** These are currently marked as `dynamic_orchestration` but should potentially be reclassified as a third type or remain as `dynamic_orchestration` with the understanding that they're not "pure" dynamic orchestration.

**Examples:**

- `assess-customer-status` (loops through customers, uses LLM for status assessment)
- `product-recommendation` (loops through customers, uses LLM for recommendations)

## 1. Predefined Workflows

### Characteristics

- **Predefined by developers** - Users cannot create their own predefined workflows
- **User provides credentials** - Users can choose which ones to use by providing their API credentials
- **Can include any node types** - Can use action, LLM, condition, loop, and other node types
- **No shared thread** - Each LLM step creates its own thread (no shared context)

### Available Predefined Workflows

The following predefined workflows are available:

- `shopify-sync-products` - Synchronize products from Shopify
- `shopify-sync-customers` - Synchronize customers from Shopify
- `circuly-sync-customers` - Synchronize customers from Circuly
- `circuly-sync-products` - Synchronize products from Circuly
- `circuly-sync-subscriptions` - Synchronize subscriptions from Circuly

### Example

```typescript
export const shopifySyncProductsWorkflow: InlineWorkflowConfig = {
  name: 'Shopify Products Sync',
  description:
    'Synchronize products from Shopify to local database with pagination',
  version: '2.0.0',
  workflowType: 'predefined', // Predefined workflow
  config: {
    timeout: 300000,
    retryPolicy: { maxRetries: 3, backoffMs: 2000 },
    variables: {
      organizationId: 'org_demo',
      shopifyDomain: 'example.myshopify.com',
      pageSize: 50,
    },
    secrets: {
      shopifyAccessToken: {
        kind: 'inlineEncrypted',
        cipherText: '...',
      },
    },
  },
};
```

## 2. (Legacy) Dynamic Orchestration Workflows

> **Note:** This section describes a previous design for dynamic orchestration workflows that is no longer active in the codebase. It is retained only for historical reference.

### Characteristics (legacy)

- **User-defined or AI-generated** - Can be created by users or generated through conversation
- **Shared thread** - All LLM steps within the same workflow execution share a single threadId from the Convex agent module
- **Focus on single object** - Each execution focuses on a single object (e.g., checking if one specific customer is churned)
- **Query and update one record** - Designed to query and update just that one record
- **Trigger + Agent nodes** - Usually has a trigger node (defines when to run) and multiple agent nodes, each with its own prompt, tool, and model

### Thread Management

For dynamic orchestration workflows:

1. A thread is created at workflow start using `components.agent.threads.createThread`
2. The threadId is stored in the `wfExecutions.threadId` field
3. All LLM steps reuse this shared threadId instead of creating new threads
4. This allows agents to maintain conversation context across steps

### Example: Single Customer Status Assessment

This is a pure agent orchestration workflow with only trigger and LLM nodes:

```typescript
export default {
  workflowConfig: {
    name: 'Single Customer Status Assessment',
    description:
      'Analyze a single customer using AI agents to determine and update their status',
    workflowType: 'dynamic_orchestration' as const,
    config: {
      timeout: 120000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000 },
      variables: {
        organizationId: 'org_demo',
        // customerId will be provided via input
      },
    },
  },
  stepsConfig: [
    // Step 1: Trigger
    {
      stepSlug: 'start',
      name: 'Manual Trigger',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'manual',
        data: {
          customerId: '{{input.customerId}}',
        },
      },
      nextSteps: { default: 'data_collector_agent' },
    },

    // Step 2: Data Collector Agent (LLM)
    {
      stepSlug: 'data_collector_agent',
      name: 'Data Collector Agent',
      stepType: 'llm',
      order: 2,
      config: {
        llmNode: {
          name: 'data_collector',
          model: 'gpt-4o-mini',
          systemPrompt: 'You are a Data Collector Agent...',
          userPrompt:
            'Gather all data for customer ID: {{trigger.data.customerId}}',
          tools: ['customer_search'],
        },
      },
      nextSteps: { success: 'status_analyzer_agent' },
    },

    // Step 3: Status Analyzer Agent (LLM)
    {
      stepSlug: 'status_analyzer_agent',
      name: 'Status Analyzer Agent',
      stepType: 'llm',
      order: 3,
      config: {
        llmNode: {
          name: 'status_analyzer',
          model: 'gpt-4o-mini',
          systemPrompt: 'You are a Status Analyzer Agent...',
          userPrompt:
            'Based on the customer data from the Data Collector Agent, analyze and determine status.',
          tools: [],
        },
      },
      nextSteps: { success: 'update_executor_agent' },
    },

    // Step 4: Update Executor Agent (LLM)
    {
      stepSlug: 'update_executor_agent',
      name: 'Update Executor Agent',
      stepType: 'llm',
      order: 4,
      config: {
        llmNode: {
          name: 'update_executor',
          model: 'gpt-4o-mini',
          systemPrompt: 'You are an Update Executor Agent...',
          userPrompt:
            'Based on the previous analysis, execute the database update using customer_update tool.',
          tools: ['customer_update'],
        },
      },
      nextSteps: { success: 'finish' },
    },

    // Step 5: Finish
    {
      stepSlug: 'finish',
      name: 'Complete Analysis',
      stepType: 'trigger',
      order: 5,
      config: { type: 'manual' },
      nextSteps: {},
    },
  ],
};
```

**Key Points:**

- Only 5 steps: 1 trigger + 3 LLM agents + 1 finish trigger
- No action, condition, or loop nodes
- Each agent has a specific role and builds on previous agents' outputs
- All agents share the same threadId for conversation context

**Important: Shared Thread Context**

Since all agents share the same threadId, they can access previous agents' outputs through the conversation history. This means:

- ❌ **No need to explicitly pass data** like `{{steps.data_collector_agent.output.data}}`
- ✅ **Agents can reference previous context** by mentioning the previous agent's role
- ✅ **Simpler prompts** - just instruct the agent to "use the data from the Data Collector Agent"
- ✅ **Natural conversation flow** - agents collaborate like a team discussing the same case

Example:

```typescript
// ❌ Old way (unnecessary with shared thread):
userPrompt: 'Analyze this data: {{steps.data_collector_agent.output.data}}';

// ✅ New way (leverages shared thread):
userPrompt: 'Based on the customer data from the Data Collector Agent, analyze and determine status.';
```

## Schema Changes

### wfDefinitions Table

Added `workflowType` field:

```typescript
workflowType: v.literal('predefined');
```

> **Note:** Earlier drafts also supported a `'dynamic_orchestration'` workflowType. That path has been removed from the current implementation; only `'predefined'` workflows are supported now.

### wfExecutions Table

Added `threadId` field for agent orchestration workflows:

```typescript
threadId: v.optional(v.string()); // Shared thread for agent orchestration workflows
```

## Implementation Details

### Thread Creation and Reuse

Thread creation and reuse now happens inside the LLM node execution layer:

- `execute_llm_node.ts` passes an optional `threadId` into the LLM executor.
- `execute_agent_with_tools.ts` either reuses this `threadId` or creates a new thread via `components.agent.threads.createThread`.

Example (from `execute_agent_with_tools.ts`):

```typescript
// Reuse existing threadId when provided, otherwise create a new one
let threadId: string;
if (_args.threadId) {
  // Reuse shared thread when threadId is provided
  threadId = _args.threadId;
  console.log('[executeAgentWithTools] Reusing shared thread', { threadId });
} else {
  // Workflows without a threadId (e.g., data sync or standalone LLM) create a new thread
  const thread = await ctx.runMutation(components.agent.threads.createThread, {
    title: `workflow:${config.name || 'LLM'}`,
  });
  threadId = thread._id as string;
  console.log('[executeAgentWithTools] Created new thread', { threadId });
}
```

This replaces the older implementation that created the thread in `execute_workflow_start.ts`.

### Thread Reuse in LLM Nodes

LLM nodes check for existing threadId in `execute_agent_with_tools.ts`:

```typescript
// Reuse existing threadId for agent orchestration workflows, or create a new one
let threadId: string;
if (_args.threadId) {
  // Agent orchestration workflow - reuse shared thread
  threadId = _args.threadId;
  console.log('[executeAgentWithTools] Reusing shared thread', { threadId });
} else {
  // Data sync workflow or standalone LLM step - create new thread
  const thread = await ctx.runMutation(components.agent.threads.createThread, {
    title: `workflow:${config.name || 'LLM'}`,
  });
  threadId = thread._id as string;
  console.log('[executeAgentWithTools] Created new thread', { threadId });
}
```

## Helper Functions

### Workflow Type Helpers

Located in `convex/workflow/types/workflow_types.ts`:

```typescript
// Check if a workflow is a predefined workflow
export function isPredefinedWorkflow(workflowType: WorkflowType): boolean {
  return workflowType === WORKFLOW_TYPE_PREDEFINED;
}

// Check if a workflow is a dynamic orchestration workflow
export function isDynamicOrchestrationWorkflow(
  workflowType: WorkflowType,
): boolean {
  return workflowType === WORKFLOW_TYPE_DYNAMIC_ORCHESTRATION;
}

// Check if a workflow key is a predefined workflow
export function isPredefinedWorkflowName(workflowKey: string): boolean {
  return PREDEFINED_WORKFLOWS.includes(workflowKey as PredefinedWorkflow);
}

// Validate that a workflow type matches its key
export function validateWorkflowTypeAndKey(
  workflowType: WorkflowType,
  workflowKey: string,
): { valid: boolean; error?: string };
```

## Migration Guide

### For Existing Workflows

All existing workflow definitions have been updated to include the `workflowType` field:

- **Predefined workflows**: `shopify-sync-*`, `circuly-sync-*`, `email-sync-*` → `workflowType: 'predefined'`
- **Dynamic orchestration workflows**: `assess-customer-status`, `product-recommendation`, etc. → `workflowType: 'dynamic_orchestration'`

### For New Workflows

When creating a new workflow, specify the `workflowType`:

```typescript
export const myWorkflow: InlineWorkflowConfig = {
  name: 'My Workflow',
  description: 'Description',
  version: '1.0.0',
  workflowType: 'predefined',
  config: {
    // ...
  },
};
```

### Default Behavior

If `workflowType` is not specified, it defaults to `'predefined'` (dynamic orchestration workflows are no longer supported).

## Benefits

1. **Clear separation of concerns** - Predefined and dynamic orchestration workflows are fundamentally different
2. **Better thread management** - Dynamic orchestration workflows maintain conversation context
3. **Improved reliability** - Predefined workflows don't need thread management overhead
4. **User experience** - Users can easily identify which workflows they can customize
5. **Scalability** - Clear boundaries make it easier to optimize each type independently
