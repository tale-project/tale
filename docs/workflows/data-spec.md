# Workflow Data Model & Conventions

This document defines the canonical data model and conventions used by the workflow engine. It explains the structure of variables available during execution, the shape of step outputs, and how loop processing interoperates with the rest of the system.

The goals of this specification:

- Clear, predictable variable names and scopes
- Minimal, consistent contracts between nodes
- Easy referencing from templates and expressions

---

## 1) Global Variables Object

During execution, the engine maintains a single variables object stored in `wfExecutions.variables` with a small, fixed set of root keys:

- `steps`: Record of per-step outputs and metadata
  - Type: `Record<string, { stepType: string, name: string, output: StepOutput }>`
  - Access pattern: `steps[stepSlug].output`
  - Each step entry includes: `stepType`, `name`, and `output`
- `lastOutput`: The most recent step's output
  - Type: `StepOutput | null`
  - Access pattern: `lastOutput`
  - Updated after each step completes
- `loop`: Loop execution namespace (only written by Loop node)
  - Type: `LoopVars`
  - Contains: `items`, `state`, `item`, `index` (sanitized to avoid persisting huge arrays)
- `organizationId`: Organization identifier injected by the system
  - Type: `Id<'organizations'>`
- `input`: Optional inbound payload (from workflow trigger)
  - Type: `unknown`
- `secrets`: Optional secrets map (decrypted from workflowConfig.secrets)
  - Type: `Record<string, string>`

Additional variables from `workflowConfig.variables` are merged at initialization.

No other root-level keys should be added by step executors.

### Example shape

```ts
interface Variables {
  steps: Record<
    string,
    {
      stepType: string;
      name: string;
      output: StepOutput;
    }
  >;
  lastOutput: StepOutput | null;
  loop?: LoopVars;
  organizationId: Id<'organizations'>;
  input?: unknown;
  secrets?: Record<string, string>;
  // Additional variables from workflowConfig.variables
  [key: string]: unknown;
}
```

---

## 2) Step Output Envelope (StepOutput)

Every node returns a standardized envelope called `StepOutput`:

```ts
type StepOutput = {
  type: string; // e.g. 'trigger' | 'llm' | 'condition' | 'action' | 'approval' | 'loop' | ...
  data: unknown; // primary, small-to-medium result payload
  meta?: Record<string, unknown>; // optional, for rich context/diagnostics
};
```

Guidelines:

- Put the primary result in `data`.
- Place additional context (diagnostics, traces, tool info, etc.) in `meta`.
- Keep both `data` and `meta` reasonably small.

The engine persists each step's `StepOutput` into `steps[stepSlug].output` and sets `lastOutput` to the same `StepOutput`.

---

## 3) Node Result Contract

Each node returns a `StepExecutionResult` containing routing and the output envelope:

```ts
interface StepExecutionResult {
  port: string; // routing key
  output: StepOutput;
  variables?: { loop?: LoopVars }; // Only Loop node writes here
  error?: string;
  threadId?: string;
  approvalTaskId?: string;
}
```

**Note**: If a step fails, it throws an exception instead of returning a failure port. The workflow execution will be marked as failed.

Rules:

- `variables` may only contain the `loop` namespace. Non-loop nodes should omit `variables`.
- `port` is used to select the next step via the current step's `nextSteps` mapping.

Common `port` values by node type:

- trigger: `success`
- condition: `true` | `false`
- action: `success` (failures throw exceptions)
- approval: `approved` | `rejected` (when resumed after approval decision)
- llm: `success`
- loop: `loop` | `done`

**Note on Approval Waiting:**
When an approval step is first executed, it creates an approval record and marks the execution as waiting (`waitingFor='approval'`) while keeping `status='running'`.
The workflow pauses and waits for user action. When the user approves/rejects via the API:

1. `approveWorkflowStep` or `rejectWorkflowStep` updates the approval status
2. `processApprovalResponse` is scheduled to resume the workflow
3. The workflow resumes with `resumeWithPort` set to `'approved'` or `'rejected'`
4. The manager routes to the next step based on this port

---

## 4) Loop Namespace (LoopVars)

Loop state is isolated under `variables.loop` and only written by the Loop node.

```ts
interface LoopVars {
  items?: unknown[]; // full items collection used by the loop
  state?: {
    currentIndex: number; // next index to process
    totalItems: number;
    iterations: number; // how many loop ticks have occurred
    batchesProcessed: number; // number of batches processed
    isComplete: boolean;
  };
  batch?: {
    index: number; // batch index (0-based)
    size: number; // batch size for this tick
    items: unknown[]; // items for this batch
    startIndex: number; // inclusive
    endIndex: number; // inclusive
  } | null;

  // Convenience fields when batchSize === 1
  item?: unknown; // current single item
  index?: number; // current item index
}
```

Loop behavior:

- First tick initializes `state` and (if non-empty) sets `batch` to the first slice of `items`.
- Subsequent ticks advance `currentIndex`, update `batch` accordingly, and increment `iterations` / `batchesProcessed`.
- Completion sets `state.isComplete = true` and `batch = null`, and returns `port = 'done'`.

The Loop node places its result in:

- `variables.loop` (items/state/batch/[item/index])
- `output`: `{ type: 'loop', data: { state, batch } }`

---

## 5) Access Patterns (Templates / Expressions)

- Last step output:
  - `{{ lastOutput.data }}...`
  - `{{ lastOutput.meta.someKey }}`
- Specific step output:
  - `{{ steps.myStepSlug.output.data }}...`
  - `{{ steps['myStepSlug'].output.meta.info }}`
- Loop context:
  - `{{ loop.state.currentIndex }}`
  - `{{ loop.batch.items }}`
  - `{{ loop.item }}` and `{{ loop.index }}` (when `batchSize = 1`)

Notes:

- `lastOutput` and `steps[...].output` are always `StepOutput` envelopes; use `.data` for primary values.
- Avoid reaching into other namespaces; only `loop` is writable and only by the Loop node.

---

## 6) Manager Persistence Rules

After each step completes successfully, the engine persists a normalized variables snapshot to `wfExecutions.variables`:

- Set `steps[stepSlug] = { stepType, name, output: result.output }`
- Set `lastOutput = result.output`
- If provided: set `loop = essentialLoop` (extracted to keep only `state`, `item`, `index`, `items`)
- Always keep `organizationId` intact
- Preserve all other existing variables from previous steps

The persistence happens in `stepExecutor.ts` after each step execution via `updateExecutionVariables`.

**Loop Variable Extraction:**
Loop variables are extracted before persistence to avoid storing huge arrays:

```ts
const essentialLoop = {
  state: loopVars.state,
  item: loopVars.item,
  index: loopVars.index,
  items: loopVars.items, // Full items array kept for continuation
};
```

No other root keys are added or modified by the step executor.

---

## 7) Next-Step Routing

Each step definition contains a port map (record of `port -> nextStepSlug`). The engine routes to the next step using the `port` returned by the current node:

```ts
const map = stepDef.nextSteps || {};
const nextStepSlug = map[stepResult.port] ?? null;
```

**Special Loop Routing:**
When a loop step returns `port = 'loop'`, the workflow manager routes back to the same loop step to process the next batch:

```ts
if (stepDef.stepType === 'loop' && stepResult.port === 'loop') {
  currentStepSlug = stepDef.stepSlug; // Loop back to same step
}
```

If `nextStepSlug` is `null`, the workflow ends and is marked as completed.

---

## 8) Types Summary

```ts
type StepOutput = {
  type: string;
  data: unknown;
  meta?: Record<string, unknown>;
};

interface StepExecutionResult {
  port: string;
  output: StepOutput;
  variables?: { loop?: LoopVars }; // Only Loop node writes here
  error?: string;
  threadId?: string;
  approvalTaskId?: string;
}

interface Variables {
  steps: Record<
    string,
    {
      stepType: string;
      name: string;
      output: StepOutput;
    }
  >;
  lastOutput: StepOutput | null;
  loop?: LoopVars;
  organizationId: Id<'organizations'>;
  input?: unknown;
  secrets?: Record<string, string>;
  [key: string]: unknown; // Additional variables from workflowConfig
}

interface LoopVars {
  items?: unknown[];
  state?: {
    currentIndex: number;
    totalItems: number;
    iterations: number;
    batchesProcessed: number;
    isComplete: boolean;
  };
  batch?: {
    index: number;
    size: number;
    items: unknown[];
    startIndex: number;
    endIndex: number;
  } | null;
  item?: unknown;
  index?: number;
}
```

---

## 9) Best Practices

- Keep `output.data` as the primary, succinct payload; place verbose context in `output.meta` when necessary.
- Only the Loop node writes `variables.loop`. Other nodes should not write to `variables`.
- Use `steps[stepSlug].output.data` and `lastOutput.data` consistently in templates for clarity and stability.
- Prefer adding semantic details to `output.meta` instead of introducing new variable namespaces.
- Step executors should NOT directly modify `wfExecutions.variables` - this is managed by `stepExecutor.ts`.
- Loop variables are automatically sanitized before persistence to avoid storing huge arrays.

---

## 10) Execution Architecture

### Database Schema

**wfDefinitions** - Workflow templates

- `organizationId`, `name`, `description`, `version`, `status`
- `config`: Contains `timeout`, `retryPolicy`, `variables`, `secrets`
- Indexes: `by_org`, `by_org_status`

**wfStepDefs** - Step definitions for workflows

- `wfDefinitionId`, `stepSlug`, `name`, `stepType`, `order`
- `config`: Step-specific configuration
- `nextSteps`: Port mapping (e.g., `{ success: 'step2' }`, `{ true: 'step3', false: 'step4' }`)
- Indexes: `by_definition`, `by_definition_order`, `by_step_id`

**wfExecutions** - Workflow execution instances

- `organizationId`, `wfDefinitionId`, `status`, `currentStepSlug`
- `variables`: Runtime variables (persisted after each step)
- `workflowConfig`: Workflow-level config (stored at execution time)
- `stepsConfig`: Map of stepSlug -> config (stored at execution time for quick access)
- `input`, `output`, `triggeredBy`, `triggerData`
- `componentWorkflowId`: Reference to @convex-dev/workflow component
- Indexes: `by_org`, `by_definition`, `by_status`, `by_component_workflow`

**approvals** - Approval tasks

- `organizationId`, `wfExecutionId`, `stepSlug`, `approverMemberId`, `status`
- `submittedData`, `decision`, `comments`, `reviewedAt`
- `resourceType`, `resourceId`, `routeHint`, `deeplink`
- `priority`, `dueDate`
- Indexes: `by_organization`, `by_approver_status`, `by_execution`, `by_resource`

### Execution Flow

1. **Workflow Start** (`api/execution.startWorkflow`)

   - Creates `wfExecution` record with status `running`
   - Loads workflow definition and steps from database
   - Stores `workflowConfig` and `stepsConfig` in execution record
   - Delegates to `@convex-dev/workflow` component via `adapter/component.startWithComponent`

2. **Component Workflow** (`manager.ts` - `dynamicWorkflow`)

   - Iterates through steps using `while (currentStepSlug)` loop
   - Calls `stepExecutor.executeStep` for each step
   - Handles loop routing (loops back to same step when `port = 'loop'`)
   - Marks execution as completed/failed when done

3. **Step Execution** (`core/stepExecutor.ts`)

   - Loads execution to get `stepsConfig` and `workflowConfig`
   - Initializes variables on first step (merges input, workflowConfig.variables, decrypts secrets)
   - Loads current variables from `wfExecutions.variables`
   - Processes config with variable replacement
   - Delegates to node-specific executor (trigger, llm, condition, approval, action, loop)
   - Persists updated variables to `wfExecutions.variables` after step completes
   - Returns control info: `{ success, port, error }`

4. **Node Executors** (`nodes/*/executor.ts`)

   - Receive: `stepDef`, `variables`, `executionId`
   - Execute node-specific logic
   - Return: `StepExecutionResult` with `output`, `port`, optional `variables.loop`

5. **Approval Flow** (`nodes/approval/executor.ts`)
   - Creates approval task in `approvals` table
   - Marks execution as waiting (`waitingFor='approval'`) while keeping `status='running'`
   - When approved/rejected, `processApprovalResponse` resumes workflow
   - Updates execution metadata with `resumeWithPort` hint
   - Calls `workflowManager.resume()` to continue execution

### Variable Initialization

On first step execution, variables are initialized as:

```ts
fullVariables = {
  ...(resumeVariables ?? initialInput ?? {}),
  ...(workflowConfig?.variables ?? {}),
  organizationId: organizationId,
  secrets: decryptedSecrets, // If workflowConfig.secrets exists
};
```

### Variable Persistence

After each step, variables are updated:

```ts
merged = {
  ...fullVariables,
  lastOutput: result.output,
  steps: {
    ...existingSteps,
    [stepSlug]: { stepType, name, output: result.output },
  },
  loop: essentialLoop, // If loop step
  organizationId: organizationId,
};
```

---

## 11) Minimal Examples

Trigger node result (example):

```ts
{
  success: true,
  port: 'success',
  output: {
    type: 'trigger',
    data: 'Trigger executed successfully',
    meta: { trigger: { type: 'webhook', receivedAt: '...' } },
  }
}
```

LLM node result (example):

```ts
{
  success: true,
  port: 'success',
  output: {
    type: 'llm',
    data: { answer: '...' },
    meta: { llm: { model: 'gpt-4o', temperature: 0.2 } },
  }
}
```

Loop node result (example tick):

```ts
{
  success: true,
  port: 'loop', // or 'done' when complete
  variables: {
    loop: {
      items: [...],
      state: { currentIndex: 10, totalItems: 100, iterations: 5, batchesProcessed: 5, isComplete: false },
      batch: { index: 5, size: 2, items: [...], startIndex: 10, endIndex: 11 },
      item: undefined, // present if batchSize === 1
      index: undefined // present if batchSize === 1
    }
  },
  output: {
    type: 'loop',
    data: { state: { ... }, batch: { ... } }
  }
}
```

---

## 12) Inline Workflows

The system supports two execution modes:

### Database Workflows

- Workflow definition stored in `wfDefinitions` table
- Steps stored in `wfStepDefs` table
- Execution references `wfDefinitionId`
- Started via `api/execution.startWorkflow`

### Inline Workflows

- Workflow configuration passed directly to execution API
- No persistent workflow definition in database
- Execution has `wfDefinitionId: null`
- Started via `api/execution.executeWorkflowWithConfig`
- Metadata includes `isInlineExecution: true`

Both modes use the same execution engine and flow through `@convex-dev/workflow` component.

**Inline Workflow API:**

```ts
executeWorkflowWithConfig({
  organizationId: Id<'organizations'>,
  workflowConfig: {
    name: string,
    description?: string,
    config?: { timeout?, retryPolicy?, variables?, secrets? }
  },
  stepsConfig: [{
    stepSlug: string,
    name: string,
    stepType: 'trigger' | 'llm' | 'condition' | 'approval' | 'action' | 'loop',
    order: number,
    config: unknown,
    nextSteps: Record<string, string>
  }],
  input?: unknown,
  triggeredBy: string,
  triggerData?: unknown
})
```

**Key Differences:**

- Inline workflows store `workflowConfig` and `stepsConfig` in execution metadata
- Database workflows load config from `wfDefinitions` and `wfStepDefs` tables
- Both store `workflowConfig` and `stepsConfig` in `wfExecutions` for quick access during execution
