# Workflow Module – MVP Development Guide

## Current Table Structure

To avoid collisions with the get-convex/workflow component’s internal table names, our definition layer uses prefixed table names: **wfDefinitions**, **wfStepDefs**, **wfExecutions**, **approvals**.

- **wfDefinitions**: Workflow templates/definitions (UI-editable)
- **wfStepDefs**: Step definitions and configuration (UI-editable)
- **wfExecutions**: Execution instances and status (authoritative view in our app; includes a mapping to the component runtime)
- **approvals**: Approval work items (unified human-in-the-loop tasks)

Note: For the execution layer we fully reuse the get-convex/workflow component (its internal tables: workflows/steps/config/onCompleteFailures). Responsibilities are clearly separated and non-overlapping; our execution records include a mapping field to the component-run workflow instance.

## 1) Scope (MVP)

- In scope
  - Workflow definition via dedicated workflow tables
  - Manual and scheduled (cron) triggers
  - Execution engine (sequential, simple condition)
  - Human approval node with pause/resume
  - Execution journaling via the @convex-dev/workflow component (start/step/finish/error)
  - Unified work management (replacing traditional tasks)

## 2) Architecture at a glance

- Separation of concerns
  - wfDefinitions: workflow template definitions (UI editable)
  - wfStepDefs: step definitions and configuration (UI editable)
  - wfExecutions: execution status (authoritative in our app)
  - approvals: human approval work items
- Data flow
  1. Define workflow template -> store in wfDefinitions
  2. Define workflow steps -> store in wfStepDefs
  3. Trigger (manual/cron/event) -> create wfExecutions -> delegate to component engine
  4. Component engine runs steps; our adapter decides next step/branch
  5. Approval step may pause (waitingFor='approval'); approver acts -> resume -> continue

## 2.5) Execution layer via Convex Workflow Component (no table collisions)

- We reuse the official execution engine (get-convex/workflow). Its own tables (workflows/steps/config/onCompleteFailures) are internal to the component.
- Our UI “definition layer” uses prefixed tables (wfDefinitions/wfStepDefs/wfExecutions/approvals), so names do not collide.
- Bridge/adapter responsibilities:

  - Start: create our wfExecutions, then create component workflow; store mapping in wfExecutions.componentWorkflowId
  - Drive: component invokes our driver after each step; we decide next step from wfStepDefs and schedule the next component step
  - Complete: component calls our completion hook; we mirror final status/output to wfExecutions

- Manager integration (internal): Workflows can also be started via a WorkflowManager wrapper. The adapter exposes internal drivers `definitionDriver` and `onWorkflowComplete` used by the manager; behavior remains the same.

Adapter functions (names to be implemented):

- public mutation workflow.adapter.startWithComponent({ organizationId, workflowId, input, triggeredBy, triggerData })
  - returns: { executionId: Id<'wfExecutions'>, componentWorkflowId: string }
- internal mutation workflow.adapter.componentDriver({ workflowId, generationNumber })
  - loads wfStepDefs, chooses next step, updates wfExecutions, and calls components.journal.startStep(...)
- internal mutation workflow.adapter.onComponentComplete({ workflowId, generationNumber, runResult })
  - mirrors final status to wfExecutions

Field mapping:

- wfExecutions.componentWorkflowId: string (maps to component workflows.\_id)
- Index: by_component_workflow(componentWorkflowId) for quick lookup by component

## 3) Unified data model (Convex schema)

### wfDefinitions (workflow template definitions)

```typescript
wfDefinitions: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  name: v.string(),
  description: v.optional(v.string()),

  version: v.string(), // version control for workflow templates
  status: v.string(), // 'draft' | 'active' | 'inactive' | 'archived'

  // Workflow-level configuration
  config: v.optional(
    v.object({
      timeout: v.optional(v.number()),
      retryPolicy: v.optional(
        v.object({
          maxRetries: v.number(),
          backoffMs: v.number(),
        }),
      ),
      variables: v.optional(v.record(v.string(), v.any())), // default variables
    }),
  ),

  metadata: v.optional(v.any()),
})
  .index('by_org', ['organizationId'])
  .index('by_org_status', ['organizationId', 'status']);
```

### wfStepDefs (step definitions)

```typescript
wfStepDefs: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  wfDefinitionId: v.id('wfDefinitions'),

  stepSlug: v.string(), // unique step identifier within workflow
  name: v.string(),
  description: v.optional(v.string()),
  stepType: v.union(
    v.literal('trigger'),
    v.literal('llm'),
    v.literal('condition'),
    v.literal('approval'),
    v.literal('action'),
  ),
  order: v.number(), // execution order

  // Flow control - structured next step definitions
  nextSteps: v.object({
    default: v.optional(v.string()),
    onSuccess: v.optional(v.string()),
    onApprove: v.optional(v.string()),
    onReject: v.optional(v.string()),
    onTrue: v.optional(v.string()),
    onFalse: v.optional(v.string()),
  }),

  // Step-specific configuration
  config: v.any(), // varies by stepType

  // Input/output mapping
  inputMapping: v.optional(v.record(v.string(), v.string())),
  outputMapping: v.optional(v.record(v.string(), v.string())),

  metadata: v.optional(v.any()),
})
  .index('by_definition', ['wfDefinitionId'])
  .index('by_definition_order', ['wfDefinitionId', 'order'])
  .index('by_step_slug', ['wfDefinitionId', 'stepSlug']);
```

### wfExecutions (single source of truth for state)

```typescript
wfExecutions: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  wfDefinitionId: v.id('wfDefinitions'), // references workflow template
  status: v.string(), // 'pending' | 'running' | 'completed' | 'failed'
  currentStepSlug: v.string(), // current step being executed
  waitingFor: v.optional(v.string()), // 'approval' | null
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),

  // Link to component workflow runtime (get-convex/workflow)
  componentWorkflowId: v.optional(v.string()),

  // Execution context and variables
  variables: v.optional(v.any()), // runtime variables
  input: v.optional(v.any()), // initial input data
  output: v.optional(v.any()), // final output data

  // Trigger information
  triggeredBy: v.optional(v.string()), // 'manual' | 'schedule' | 'webhook' | 'event'
  triggerData: v.optional(v.any()), // trigger-specific data

  metadata: v.optional(v.any()),
})
  .index('by_org', ['organizationId'])
  .index('by_definition', ['wfDefinitionId'])
  .index('by_status', ['status'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_component_workflow', ['componentWorkflowId']);
```

### approvals (unified approval system)

```typescript
approvals: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  workflowExecutionId: v.optional(v.id('wfExecutions')), // references execution
  stepSlug: v.optional(v.string()), // references the approval step
  approverMemberId: v.optional(v.id('members')), // can be null for unassigned tasks
  status: v.string(), // 'pending' | 'approved' | 'rejected'

  // Approval data
  submittedData: v.any(), // data submitted for approval
  decision: v.optional(v.string()), // 'approve' | 'reject'
  comments: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  decidedAt: v.optional(v.number()),
  assignedAt: v.optional(v.number()),

  // UI routing and resource hints
  resourceType: v.union(
    v.literal('conversations'),
    v.literal('product_recommendation'),
  ), // 'conversations' | 'product_recommendation'
  resourceId: v.string(),
  routeHint: v.optional(v.string()), // 'conversation' | 'task_center'
  deeplink: v.optional(v.string()),

  // Priority and timing
  priority: v.string(), // 'low' | 'medium' | 'high' | 'urgent'
  dueDate: v.optional(v.number()),

  metadata: v.optional(v.any()),
})
  .index('by_organization', ['organizationId'])
  .index('by_approver_status', ['approverMemberId', 'status'])
  .index('by_execution', ['workflowExecutionId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_resource', ['resourceType', 'resourceId']);
```

## 4) Workflow definition examples

### Simple approval workflow (replaces traditional tasks)

```typescript
// Workflow template
{
  name: "Product Recommendation Approval",
  config: {
    timeout: 86400000, // 24 hours
    variables: {
      defaultPriority: "medium"
    }
  }
}

// Workflow steps
[
  {
    stepSlug: "start",
    stepType: "trigger",
    order: 1,
    config: {
      type: "manual"
    },
    nextSteps: { default: "approval" }
  },
  {
    stepSlug: "approval",
    stepType: "approval",
    order: 2,
    config: {
      approverRole: "reviewer",
      resourceType: "product_recommendation",
      allowDataModification: false
    },
    nextSteps: {
      onApprove: "send_recommendation",
      onReject: "log_rejection"
    }
  },
  {
    stepSlug: "send_recommendation",
    stepType: "action",
    order: 3,
    config: {
      type: "conversation",
      parameters: {
        operation: "create",
        // Create an email conversation with the approved recommendations
        organizationId: "{{organizationId}}",
        customerId: "{{customerId}}",
        subject: "Product Recommendations",
        channel: "email",
        direction: "outbound"
      }
    },
    nextSteps: { default: "end" }
  },
  {
    stepSlug: "log_rejection",
    stepType: "action",
    order: 4,
    config: {
      type: "log",
      message: "Product recommendation rejected"
    },
    nextSteps: { default: "end" }
  }
]
```

### Data synchronization workflow

```typescript
// Workflow template
{
  name: 'Shopify Data Sync';
}

// Workflow steps
[
  {
    stepSlug: 'start',
    stepType: 'trigger',
    order: 1,
    config: {
      type: 'schedule',
      schedule: '0 */6 * * *', // every 6 hours
      timezone: 'UTC',
    },
    nextSteps: { default: 'sync_products' },
  },
  {
    stepSlug: 'sync_products',
    stepType: 'action',
    order: 2,
    config: {
      type: 'shopify_sync',
      resource: 'products',
      batchSize: 100,
    },
    nextSteps: {
      onSuccess: 'sync_customers',
    },
  },
  {
    stepSlug: 'sync_customers',
    stepType: 'action',
    order: 3,
    config: {
      type: 'shopify_sync',
      resource: 'customers',
      batchSize: 50,
    },
    nextSteps: {
      onSuccess: 'complete',
    },
  },
];
```

### Complex business process workflow

```typescript
// Workflow template
{
  name: "Customer Churn Prevention",
  triggers: {
    event: "subscription_cancelled"
  }
}

// Workflow steps
[
  {
    stepSlug: "analyze_churn_risk",
    stepType: "llm",
    order: 1,
    config: {
	      name: "Analyze Churn Risk",
	      // Model is configured globally via OPENAI_MODEL and is not set per step
	      temperature: 0.2,
	      systemPrompt: "Analyze customer churn risk based on: {{customer_data}}"
    },
    inputMapping: {
      customer_data: "{{workflow.input.customer}}"
    },
    nextSteps: { default: "risk_assessment" }
  },
  {
    stepSlug: "risk_assessment",
    stepType: "condition",
    order: 2,
    config: {
      expr: "{{churn_risk_score}} > 0.7"
    },
    nextSteps: {
      onTrue: "manual_review",
      onFalse: "auto_retention"
    }
  },
  {
    stepSlug: "manual_review",
    stepType: "approval",
    order: 3,
    config: {
      approverRole: "account_manager",
      resourceType: "churn_prevention",
      priority: "high"
    },
    nextSteps: {
      onApprove: "personal_outreach",
      onReject: "auto_retention"
    }
  },
  {
    stepSlug: "auto_retention",
    stepType: "action",
    order: 4,
    config: {
      type: "send_retention_email",
      template: "standard_retention"
    }
  }
]
```

## 5) Supported node types (MVP)

### Common step metadata

- stepSlug: string (unique within workflow)
- stepType: 'trigger' | 'llm' | 'condition' | 'approval' | 'action'
- order: number
- nextSteps: structured flow control object
- inputMapping: variable mapping from workflow context
- outputMapping: variable mapping to workflow context

### 1. Trigger

- Purpose: Start workflow execution
- Config: varies by trigger type
- Behavior: initializes execution context

```typescript
{
  stepSlug: 'start',
  stepType: 'trigger',
  order: 1,
  config: {
    type: 'manual' | 'schedule' | 'webhook' | 'event'
  },
  nextSteps: { default: 'next_step' }
}
```

### 2. LLM

- Purpose: AI reasoning/generation
- Config: model settings and prompts
- Inputs: prompt, context data
- Outputs: AI response, usage metrics

```typescript
{
  stepSlug: 'analyze',
  stepType: 'llm',
  order: 2,
  config: {
	    name: 'Analyzer',
	    // Model is configured globally via OPENAI_MODEL and is not set per step
	    temperature: 0.2,
	    maxTokens: 1000,
	    systemPrompt: 'Analyze the following data: {{input_data}}'
  },
  nextSteps: { default: 'next_step' }
}
```

### 3. Condition

- Purpose: Boolean branching logic
- Config: expression to evaluate
- Inputs: variables referenced in expression
- Outputs: boolean result

```typescript
{
  stepSlug: 'gate',
  stepType: 'condition',
  order: 3,
  config: {
    expr: '{{score}} > 0.7'
  },
  nextSteps: {
    onTrue: 'approve_path',
    onFalse: 'reject_path'
  }
}
```

### 4. Approval

- Purpose: Human-in-the-loop decision making
- Config: approver settings and UI hints
- Side effects: creates Approval record and marks execution as waiting (`waitingFor='approval'`)
- Resume: via approve/reject actions

```typescript
{
  stepSlug: 'review',
  stepType: 'approval',
  order: 4,
  config: {
    approverMemberId: 'member_123',
    resourceType: 'product_recommendation',
    priority: 'high',
    dueDate: '{{now + 86400000}}' // 24 hours
  },
  nextSteps: {
    onApprove: 'send_recommendation',
    onReject: 'log_rejection'
  }
}
```

### 5. Action

- Purpose: Execute side effects
- Config: action type and parameters
- Types: log, webhook, email, platform_integration, etc.

```typescript
{
  stepSlug: 'notify',
  stepType: 'action',
  order: 5,
  config: {
    type: 'webhook',
    url: 'https://api.example.com/notify',
    method: 'POST',
    body: {
      event: 'workflow_completed',
      data: '{{workflow.output}}'
    }
  },
  nextSteps: { default: 'end' }
}
```

### Validation (minimal)

- stepSlug: required, unique within workflow
- stepType: required, must be one of supported types
- routeability: all nextSteps targets must refer to existing stepSlug (or end)
- approval: approverMemberId required
- condition: expr required; must resolve to boolean

## 6) Scheduled triggers (cron)

- Store cron expressions in workflow.triggers.schedule
- Use Convex crons to scan and trigger eligible workflows

```typescript
const crons = cronJobs();
crons.cron(
  'scan workflows',
  '*/5 * * * *',
  internal.workflows.scanAndTrigger,
  {},
);
export default crons;
```

- Internal action scans active workflows with due schedules

```typescript
export const scanAndTrigger = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Find workflows with schedule triggers that are due
    // Create new executions for each eligible workflow
    return null;
  },
});
```

## 7) Execution lifecycle (pause/resume)

### Start

- Create wfExecutions(status='running')
- Initialize variables with input data and workflow defaults
- Log workflow_started event

### Step Processing

- Load current step definition from wfStepDefs
- Execute step based on stepType
- Update execution variables with step outputs
- Determine next step based on step result and nextSteps configuration

### Approval Step (pause/resume)

- Create approvals(status='pending')
- Update wfExecutions -> status remains 'running', waitingFor='approval'
- Optionally log a workflow_waiting event
- On approve/reject: update approvals and resume execution
- Continue to next step based on approval decision

### Completion

- Update workflowExecutions -> status='completed'/'failed'
- Set completedAt timestamp
- Log workflow_completed/workflow_failed event

- Cancel behavior: Cancelling an execution sets status='failed' with error='canceled'.

## 8) Unified work management

### Replacing traditional tasks

All work items are now modeled as workflows:

1. **Simple approval tasks** → Single-step approval workflows
2. **Data sync tasks** → Single-step action workflows
3. **Complex processes** → Multi-step workflows with conditions and approvals
4. **Recurring work** → Scheduled workflows

### Benefits

- **Unified interface**: All work managed through workflow system
- **Consistent state management**: Single execution model
- **Easy evolution**: Simple workflows can grow into complex processes
- **Better visibility**: All work visible in workflow dashboard
- **Audit trail**: Complete execution history in logs

### Migration from tasks

1. **Product recommendation approvals** → Approval workflows
2. **Data synchronization** → Action workflows
3. **Manual assignments** → Manual trigger workflows
4. **Recurring maintenance** → Scheduled workflows

## 9) Minimal API surface (Convex new syntax)

### Start/Run workflow

```typescript
export const run = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(v.any()),
    triggeredBy: v.optional(v.string()),
  },
  returns: v.object({ executionId: v.id('wfExecutions') }),
  handler: async (ctx, args) => {
    // Create execution and start workflow
  },
});
```

### Step runner (internal)

```typescript
export const processStep = internalMutation({
  args: { executionId: v.id('wfExecutions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Load current step and execute based on stepType
    return null;
  },
});
```

### Approve / Reject

```typescript
export const approve = mutation({
  args: {
    approvalId: v.id('approvals'),
    decision: v.union(v.literal('approve'), v.literal('reject')),
    comments: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Update approval record and resume workflow
  },
});
```

## 10) State machine (execution.status)

- **pending** → **running** → **completed**
- **running** → **failed** (on unrecoverable error or cancel; cancel records error='canceled')
- currentStepId indicates progress
- waitingFor explains pause reason ('approval' | null)
- Approval records can be found by querying the approvals table with workflowExecutionId

## 11) Human approval and UI integration

### Unified approval system

- All approvals flow through Approvals table
- Single "My Tasks" inbox for all approval types
- Consistent approval interface across different resource types

### Resource type routing

- **product_recommendation** → Task center with product details
- **message_draft** → Conversation UI with editing capabilities
- **predefined_workflow** → Admin dashboard with sync status
- **churn_prevention** → Customer management interface

### Approval workflow

1. Workflow reaches approval step
2. Approval record created with resource metadata
3. Approver receives notification with deep link
4. Approver reviews in appropriate UI
5. Decision recorded, workflow resumes
6. Next step determined by approval outcome

## 12) Example: End-to-end workflow execution

### Product recommendation approval workflow

1. **Trigger**: Customer makes purchase, triggers workflow
2. **Data preparation**: Load customer history and product catalog
3. **AI analysis**: Generate product recommendations using LLM
4. **Quality check**: Condition step validates recommendation quality
5. **Human approval**: If quality uncertain, pause for manual review (status stays running, `waitingFor='approval'`)
6. **Action**: Send approved recommendations or log rejection
7. **Completion**: Update customer profile and log results

### Execution flow

```
purchase_event → load_data → generate_recommendations → quality_check
                                                            ↓
                                                    [high_quality]
                                                            ↓
                                                    send_recommendations
                                                            ↓
                                                         complete

                                                    [low_quality]
                                                            ↓
                                                    manual_review
                                                       ↓     ↓
                                                  [approve] [reject]
                                                       ↓     ↓
                                              send_recommendations log_rejection
                                                       ↓     ↓
                                                    complete complete
```

### Example: approval pause/resume (core snippet)

```typescript
const approvalId = await ctx.db.insert('approvals', {
  organizationId,
  workflowExecutionId: execId,
  stepSlug: currentStepSlug,
  approverMemberId,
  status: 'pending',
  submittedData: stepOutput,
  resourceType: 'product_recommendation',
  resourceId: 'some_resource_id',
  priority: 'medium',
  assignedAt: Date.now(),
});

await ctx.db.patch(execId, {
  waitingFor: 'approval',
  updatedAt: Date.now(),
});

This unified workflow system replaces the traditional task management approach with a more flexible, scalable, and consistent model that can handle everything from simple approvals to complex business processes.
```
