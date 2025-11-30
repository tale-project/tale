# AI Workflow Assistant - Complete Guide

## Overview

The AI-powered workflow assistant enables users to create, modify, and understand workflows through natural language conversations. It combines AI intelligence with workflow automation to make complex automation accessible to all users.

## Architecture

### Components

1. **Workflow Tools** (`convex/agent_tools/convex_tools/workflows/`)

   - `get_workflow_structure.ts` - Retrieves complete workflow structure
   - `update_workflow_step.ts` - Updates existing steps (for small, targeted edits)
   - `generate_workflow_from_description.ts` - AI-powered initial workflow generation
   - `save_workflow_definition.ts` - Saves/updates an entire workflow (metadata + all steps) in one atomic operation
   - `list_available_actions.ts` - Discovers all available action types
   - `search_workflow_examples.ts` - Searches existing workflows for examples

2. **Workflow Assistant Agent** (`convex/workflow_assistant_agent.ts`)

   - Main entry point for AI conversations
   - Automatically loads workflow context
   - Handles tool execution and response generation

3. **Agent Configuration** (`convex/lib/create_workflow_agent.ts`)

   - Specialized agent with workflow-specific instructions
   - Lower temperature (0.3) for consistent generation
   - Comprehensive system prompt with examples

4. **Frontend Integration** (`app/.../automation-sidepanel.tsx`)
   - Real-time chat interface
   - Connects to workflow assistant backend
   - Context-aware conversations

## Features

### 1. Workflow Understanding

The AI can analyze and explain existing workflows:

- Reads workflow structure and steps
- Explains what each step does
- Identifies potential improvements

### 2. Workflow Creation

Generate complete workflows from natural language:

```
User: "Create a workflow that sends product recommendations to inactive customers"
AI: [Generates complete workflow with trigger, data fetching, AI analysis, and email steps]
```

### 3. Workflow Modification

Make targeted changes to existing workflows:

- Add new steps
- Update step configurations
- Remove unnecessary steps
- Modify step connections

### 4. Context Awareness

The assistant automatically:

- Loads current workflow structure when workflowId is provided
- Maintains conversation context across messages
- Provides relevant suggestions based on workflow state

### 5. Knowledge Discovery

Two powerful knowledge tools help the AI discover and learn:

#### `list_available_actions` 🔧

Discovers all available action types that can be used in workflow steps.

**Returns:**

- Action type (e.g., `customer`, `product`, `conversation`, `email_provider`)
- Title and description
- All operations supported (e.g., `create`, `query`, `update`)
- All parameters (required and optional)
- Category (customer, product, email, conversation, etc.)
- Usage example with proper syntax

**Categories available:**

- `customer` - Customer management operations
- `product` - Product management operations
- `email` - Email sending operations
- `conversation` - Conversation/messaging operations
- `document` - Document management operations
- `integration` - Third-party integrations (Shopify, Circuly, OneDrive)
- `workflow` - Workflow-specific operations (approvals, processing records)
- `knowledge` - Knowledge base operations (RAG)
- `web` - Web crawling and website operations

#### `search_workflow_examples` 📚

Searches existing workflows to find examples and learn from existing structures.

**Returns:**

- Workflow name and description
- Status (active/inactive)
- Step count
- Step structure (includes full config)
  - Step ID, name, type, order
  - Full step config
  - Next steps connections

**Search tips:**

- Use keywords like "email", "customer", "product", "recommendation"
- Set `includeInactive: true` to see draft/inactive workflows
- Adjust `limit` to control number of results (default: 5)

## Usage Examples

### Creating a New Workflow

**User:** "I want to create a workflow that finds customers who haven't purchased in 30 days and sends them personalized product recommendations"

**AI Response:**

1. Searches for similar examples using `search_workflow_examples`
2. Discovers available actions using `list_available_actions`
3. Analyzes the requirement and breaks it down into logical steps
4. Uses `generate_workflow_from_description` tool
5. Creates workflow with:
   - Trigger (scheduled daily)
   - Find inactive customers (action)
   - Analyze purchase history (LLM)
   - Generate recommendations (LLM)
   - Send email (action)

### Modifying an Existing Workflow

**User:** "Add a step that checks if customers have opened previous emails"

**AI Response:**

1. Uses `get_workflow_structure` to understand current workflow
2. Identifies where to insert the new step
3. Regenerates the full list of steps (including the new email engagement check)
4. Uses `save_workflow_definition` to replace the workflow's steps atomically
5. Confirms the changes

### Understanding a Workflow

**User:** "What does this workflow do?"

**AI Response:**

1. Uses `get_workflow_structure` to load workflow
2. Analyzes each step
3. Provides clear explanation of:
   - Overall purpose
   - Each step's function
   - How steps connect
   - Potential improvements

## Technical Details

### Tool Registry Integration

All workflow tools are registered in `convex/agent_tools/tool_registry.ts`:

```typescript
export const TOOL_REGISTRY = [
  // ... existing tools
  getWorkflowStructureTool,
  updateWorkflowStepTool,
  generateWorkflowFromDescriptionTool,
  saveWorkflowDefinitionTool,
  listAvailableActionsTool,
  searchWorkflowExamplesTool,
] as const;
```

### Workflow Context Loading

When a `workflowId` is provided, the assistant automatically loads:

- Workflow name, description, and status
- All steps with their configurations
- Step connections and order
- This context is injected into the conversation

### AI Model Configuration

- **Model:** GPT-4o (configurable via `OPENAI_MODEL` env var)
- **Temperature:** 0.3 (lower for consistent workflow generation)
- **Max Steps:** 15 (allows complex multi-step operations)

### Available Step Types

1. **trigger** - Starts workflow (manual, scheduled, event-based)
2. **llm** - AI agent with tools and decision-making
3. **action** - Database queries, API calls, operations
4. **condition** - Branching logic based on expressions
5. **loop** - Iteration over collections

### Workflow Creation Flow

1. **User requests a workflow**

   ```
   User: "Create a workflow that sends abandoned cart emails"
   ```

2. **AI searches for similar examples**

   ```
   AI: search_workflow_examples({ query: "abandoned cart email" })
   ```

3. **AI discovers available actions**

   ```
   AI: list_available_actions({ category: "email" })
   AI: list_available_actions({ category: "customer" })
   ```

4. **AI generates the workflow**
   - Uses patterns from examples
   - Uses correct action types and operations
   - Includes all required parameters
   - Follows best practices

### Benefits

✅ **Consistency** - AI learns from existing workflows and maintains consistent patterns
✅ **Accuracy** - AI knows exactly what actions and operations are available
✅ **Completeness** - AI includes all required parameters
✅ **Best Practices** - AI follows patterns that have been proven to work

## Best Practices

### For Users

1. **Be Specific** - Provide clear descriptions of what you want
2. **Ask Questions** - The AI will clarify if needed
3. **Review Changes** - Always review AI-generated workflows
4. **Iterate** - Start simple and add complexity gradually

### For Developers

1. **Tool Design** - Keep tools focused and single-purpose
2. **Error Handling** - Always return success/failure status
3. **Context** - Pass organizationId and workflowId in context
4. **Validation** - Validate AI-generated configurations
5. **Testing** - Test with various natural language inputs

## Testing Guide

### Quick Start Testing

#### 1. Test Workflow Creation

Open the workflow editor and click the AI Assistant button. Try these prompts:

**Simple Workflow:**

```
Create a workflow that sends a welcome email to new customers
```

**Expected Result:**

- Workflow with trigger step
- Action to send email
- Proper step connections

**Complex Workflow:**

```
Create a workflow that:
1. Finds customers who haven't purchased in 30 days
2. Analyzes their purchase history using AI
3. Generates 3-5 product recommendations
4. Sends a personalized email with recommendations
```

**Expected Result:**

- Multi-step workflow with trigger, actions, and LLM steps
- Proper tool configuration for LLM steps
- Logical step ordering and connections

#### 2. Test Workflow Modification

Open an existing workflow and ask:

```
Add a step that checks if the customer has opened previous emails before sending
```

**Expected Result:**

- AI loads current workflow structure
- Adds condition step in appropriate location
- Updates step connections
- Confirms the change

#### 3. Test Workflow Understanding

Open an existing workflow and ask:

```
What does this workflow do?
```

**Expected Result:**

- Clear explanation of workflow purpose
- Description of each step
- How steps connect together
- Potential suggestions for improvement

#### 4. Test Context Awareness

In an existing workflow, ask:

```
How many steps does this workflow have?
```

**Expected Result:**

- Accurate count of steps
- Brief description of step types

Then ask:

```
Can you add a loop to process multiple customers?
```

**Expected Result:**

- AI understands the current workflow context
- Suggests where to add the loop
- Creates the loop step with proper configuration

### Test Scenarios

#### Scenario 1: E-commerce Re-engagement

**Prompt:**

```
Create a customer re-engagement workflow that:
- Runs daily at 9 AM
- Finds customers inactive for 30+ days
- Uses AI to analyze their browsing and purchase history
- Generates personalized product recommendations
- Sends email only if customer has good email engagement
```

**Validation:**

- [ ] Trigger step with schedule configuration
- [ ] Action step to find inactive customers
- [ ] LLM step with appropriate tools (customer_search, list_products)
- [ ] Condition step for email engagement check
- [ ] Action step to send email
- [ ] All steps properly connected

#### Scenario 2: Product Recommendation

**Prompt:**

```
I need a workflow that recommends products based on what customers viewed but didn't buy
```

**Validation:**

- [ ] Workflow created with logical steps
- [ ] Uses customer and product tools
- [ ] Includes AI analysis step
- [ ] Has email/notification step

#### Scenario 3: Workflow Modification

**Setup:** Open existing workflow with 3 steps

**Prompt:**

```
Add a step between step 2 and step 3 that validates the data
```

**Validation:**

- [ ] AI loads current workflow
- [ ] Creates new step with order 2.5 or reorders existing steps
- [ ] Updates connections properly
- [ ] Confirms the change

#### Scenario 4: Error Handling

**Prompt:**

```
Add error handling to this workflow
```

**Validation:**

- [ ] AI suggests adding condition steps
- [ ] Adds failure paths in nextSteps
- [ ] Suggests error notification steps

### Manual Testing Checklist

#### Backend Tests

- [ ] `get_workflow_structure` tool returns correct data
- [ ] `create_workflow_step` tool creates steps successfully
- [ ] `update_workflow_step` tool updates configurations
- [ ] `delete_workflow_step` tool removes steps
- [ ] `generate_workflow_from_description` creates valid workflows
- [ ] `list_available_actions` returns all action types
- [ ] `search_workflow_examples` finds relevant workflows
- [ ] Workflow context loads automatically when workflowId provided
- [ ] organizationId is properly passed to tools

#### Frontend Tests

- [ ] AI Assistant panel opens/closes correctly
- [ ] Welcome message appears when panel opens
- [ ] User messages display correctly
- [ ] AI responses stream/display properly
- [ ] Loading state shows during AI processing
- [ ] Error messages display when API fails
- [ ] Thread ID is unique per workflow
- [ ] Panel is resizable

#### Integration Tests

- [ ] Created workflows appear in workflow list
- [ ] Modified workflows update in real-time
- [ ] Deleted steps are removed from database
- [ ] Workflow execution works with AI-generated workflows
- [ ] Tool calls are logged and visible
- [ ] Context is maintained across multiple messages

### Performance Testing

#### Response Time

- [ ] Simple queries respond in < 3 seconds
- [ ] Complex workflow generation completes in < 10 seconds
- [ ] Workflow structure loading is fast (< 1 second)

#### Reliability

- [ ] AI consistently generates valid workflow structures
- [ ] Tool calls succeed reliably
- [ ] Error handling works for invalid inputs
- [ ] Context loading handles missing workflows gracefully

### Edge Cases

#### Test Invalid Inputs

1. **Empty workflow description**

   ```
   Create a workflow
   ```

   Expected: AI asks for more details

2. **Ambiguous request**

   ```
   Make it better
   ```

   Expected: AI asks what to improve

3. **Non-existent workflow**

   - Open AI chat without workflowId
   - Ask about "this workflow"
     Expected: AI explains no workflow is loaded

4. **Invalid step configuration**
   ```
   Add a step with type "invalid_type"
   ```
   Expected: AI suggests valid step types

### Debugging Tips

#### Enable Verbose Logging

Check browser console for:

- Tool execution logs
- API call responses
- Error messages

Check Convex logs for:

- Agent execution traces
- Tool call results
- Workflow creation/modification logs

#### Common Issues

**Issue:** AI doesn't create workflow

- Check: organizationId is provided
- Check: OPENAI_API_KEY is set
- Check: Tool registry includes workflow tools

**Issue:** Context not loading

- Check: workflowId is valid
- Check: Workflow exists in database
- Check: User has access to workflow

**Issue:** Tools not executing

- Check: Tool names match registry
- Check: Context includes organizationId
- Check: Tool handlers don't throw errors

### Success Criteria

The AI Workflow Assistant is working correctly when:

✅ Users can create workflows from natural language descriptions
✅ AI generates valid, executable workflow structures
✅ Workflow modifications work reliably
✅ Context is maintained throughout conversations
✅ Error messages are clear and helpful
✅ Response times are acceptable (< 10s for complex operations)
✅ Tool calls succeed consistently
✅ Generated workflows execute successfully

## Troubleshooting

### Common Issues

**Issue:** AI doesn't understand the request

- **Solution:** Be more specific, provide examples

**Issue:** Workflow generation fails

- **Solution:** Check logs, verify organizationId is provided

**Issue:** Tools not executing

- **Solution:** Verify tool registry, check context variables

**Issue:** Context not loading

- **Solution:** Ensure workflowId is valid and workflow exists

## API Reference

### `chatWithWorkflowAssistant`

```typescript
action({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    workflowId: v.optional(v.id('wfDefinitions')),
    message: v.string(),
    maxSteps: v.optional(v.number()),
  },
  returns: v.object({
    response: v.string(),
    toolCalls: v.optional(v.array(...)),
  }),
})
```

## Future Enhancements

Potential improvements to consider:

1. **Undo/Redo** - Track AI actions for easy reversal
2. **Templates** - Pre-built workflow templates
3. **Visual Feedback** - Highlight changes in the workflow canvas
4. **Validation** - Pre-execution workflow validation
5. **Testing** - AI-assisted workflow testing
6. **Optimization** - AI suggestions for performance improvements
7. **Documentation** - Auto-generate workflow documentation

## Conclusion

The AI Workflow Assistant provides a powerful, intuitive way to create and manage workflows through natural language. It combines the flexibility of AI with the structure of workflow automation, making complex automation accessible to all users.

The knowledge tools (`list_available_actions` and `search_workflow_examples`) ensure the AI generates consistent, accurate workflows by learning from existing patterns and understanding available capabilities.
