# Workflow Module Refactoring Summary

## Overview

Successfully refactored the workflow module to distinguish between two main workflow types and implemented shared thread context for dynamic orchestration workflows.

## Key Changes

### 1. Workflow Type Classification

**Two Main Types:**

1. **Predefined Workflows** (`workflowType: 'predefined'`)

   - Developer-defined workflows for platform integrations and data operations
   - Users can't create their own, but can choose which to use
   - Can include any node types (action, LLM, agent, condition, loop, etc.)
   - Each LLM/agent step creates its own thread (no shared context)

2. **Dynamic Orchestration Workflows** (`workflowType: 'dynamic_orchestration'`)
   - User-defined or AI-generated workflows
   - All LLM steps share a single threadId
   - Focus on single objects (e.g., one customer)
   - Pure structure: 1 trigger + multiple LLM nodes + 1 finish trigger

### 2. Pure Dynamic Orchestration Structure

**Required Structure:**

- ✅ 1 Trigger node (defines when to run)
- ✅ Multiple LLM nodes (each representing a different agent role)
- ✅ 1 Finish trigger node
- ❌ No action, condition, or loop nodes

**Example: Single Customer Status Assessment**

```
Trigger → Data Collector Agent → Status Analyzer Agent → Update Executor Agent → Finish
```

### 3. Shared Thread Context

**Key Innovation:**
All agents in an agent orchestration workflow share the same threadId, enabling:

- **Natural conversation flow** - Agents collaborate like a team discussing the same case
- **Context continuity** - Each agent can access previous agents' outputs through conversation history
- **Simpler prompts** - No need to explicitly pass data between agents
- **Complete audit trail** - All agent interactions are recorded in one thread

**Before (unnecessary):**

```typescript
userPrompt: 'Analyze this data: {{steps.data_collector_agent.output.data}}';
```

**After (leverages shared thread):**

```typescript
userPrompt: 'Based on the customer data from the Data Collector Agent, analyze and determine status.';
```

## Files Modified

### Schema Changes

- ✅ `convex/schema.ts` - Added `workflowType` and `threadId` fields

### Type Definitions

- ✅ `convex/workflow/types/workflow.ts` - Added workflow type definitions
- ✅ `convex/workflow/types/workflow_types.ts` - Created helper functions
- ✅ `convex/workflow/types/inline.ts` - Updated inline workflow config

### Workflow Execution

- ✅ `convex/workflow/engine/execute_workflow_start.ts` - Shared helper that starts workflows for existing `wfExecutions` records
- ✅ `convex/workflow/engine/dynamic_workflow.ts` - Passes threadId through steps
- ✅ `convex/workflow/core/step_execution/execute_step_by_type.ts` - Passes threadId to LLM nodes

### LLM Node Executor

- ✅ `convex/workflow/nodes/llm/execute_llm_node.ts` - Accepts threadId parameter
- ✅ `convex/workflow/nodes/llm/execute_agent_with_tools.ts` - Reuses threadId for agent orchestration
- ✅ `convex/workflow/nodes/llm/types.ts` - Added threadId to result type

### Workflow Definitions

**Data Sync Workflows:**

- ✅ `workflows/shopify-sync-products.ts`
- ✅ `workflows/shopify-sync-customers.ts`
- ✅ `workflows/circuly-sync-customers.ts`
- ✅ `workflows/circuly-sync-products.ts`
- ✅ `workflows/circuly-sync-subscriptions.ts`

**Agent Orchestration Workflows:**

- ✅ `workflows/assess-customer-status.ts` - **Refactored to pure agent orchestration**
- ✅ `workflows/product-recommendation.ts`
- ✅ `workflows/product-relationship-analysis.ts`
- ✅ `workflows/send-churn-survey-email.ts`
- ✅ `workflows/find-product-by-shop-variant-id.ts`

### Documentation

- ✅ `docs/workflows/workflow-types.md` - Comprehensive documentation
- ✅ `docs/workflows/REFACTORING_SUMMARY.md` - This file

## Example: assess-customer-status.ts Transformation

### Before (Hybrid Workflow)

- Mixed action, condition, loop, and LLM nodes
- Processed multiple customers with pagination
- Complex control flow with branching logic
- ~245 lines of code

### After (Pure Agent Orchestration)

- Only trigger and LLM nodes
- Focuses on ONE customer per execution
- Linear agent collaboration flow
- ~196 lines of code
- Cleaner, more maintainable structure

**Agent Flow:**

1. **Trigger** - Manual trigger with customerId input
2. **Data Collector Agent** - Retrieves customer data using `customer_search` tool
3. **Status Analyzer Agent** - Analyzes subscription patterns to determine status
4. **Update Executor Agent** - Updates database using `customer_update` tool
5. **Finish** - Completes workflow

## Thread Management Flow

### Agent Orchestration Workflow:

1. Workflow starts → Create thread via `components.agent.threads.createThread`
2. Store `threadId` in `wfExecutions.threadId`
3. Pass `threadId` to all LLM steps
4. Each LLM step reuses the same thread → **Maintains conversation context**

### Data Sync Workflow:

1. Workflow starts → No thread created
2. Each LLM step (if any) creates its own thread → **Independent execution**

## Benefits

1. **Clear Separation of Concerns**

   - Data sync and agent orchestration are distinct concepts
   - Each type is optimized for its specific use case

2. **Shared Thread Context**

   - Agents maintain conversation context across steps
   - Natural collaboration between agents
   - Complete audit trail in one thread

3. **Simpler Prompts**

   - No need to explicitly pass data between agents
   - Agents reference previous context naturally
   - More maintainable and readable

4. **Better User Experience**

   - Users can easily identify which workflows they can customize
   - Clear distinction between predefined and user-defined workflows

5. **Improved Reliability**

   - Pure agent orchestration focuses on single objects
   - Reduces complexity and potential for errors
   - Easier to test and debug

6. **Scalability**
   - Clear boundaries make it easier to optimize each type independently
   - Agent orchestration can be AI-generated through conversation
   - Data sync workflows remain stable and predefined

## Migration Guide

### For Existing Workflows

All existing workflow definitions have been updated to include the `workflowType` field:

- **Predefined workflows**: `workflowType: 'predefined'`
- **Dynamic orchestration workflows**: `workflowType: 'dynamic_orchestration'`

### For New Workflows

When creating a new dynamic orchestration workflow:

1. Set `workflowType: 'dynamic_orchestration'`
2. Use only trigger and LLM nodes
3. Focus on a single object per execution
4. Let agents reference previous context naturally (no explicit data passing)
5. Each agent should have a clear role and responsibility

### Default Behavior

If `workflowType` is not specified, it defaults to `'dynamic_orchestration'` for backward compatibility.

## Next Steps

1. **Test the Implementation**

   - Test data sync workflows still create individual threads per LLM step
   - Test agent orchestration workflows share a single thread across all LLM steps
   - Verify thread creation and reuse logic works correctly

2. **Refactor Other Workflows**

   - Consider refactoring other hybrid workflows to pure agent orchestration
   - Identify workflows that should remain hybrid (if any)

3. **AI-Generated Workflows**

   - Implement conversation-based workflow generation
   - Use the pure agent orchestration structure as the template

4. **Performance Optimization**
   - Monitor thread usage and performance
   - Optimize agent prompts for better collaboration
   - Consider caching strategies for frequently accessed data

## Conclusion

The workflow module has been successfully refactored to support two distinct workflow types with clear separation of concerns. The pure agent orchestration structure with shared thread context enables natural agent collaboration and simplifies workflow development.
