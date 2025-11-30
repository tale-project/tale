# Manual Workflow Configuration Execution

This feature allows you to execute workflows by providing JSON configuration directly, bypassing the need for database-stored workflow definitions. This is useful for testing, prototyping, and one-off workflow executions.

## How to Access

1. Navigate to the Workflow Demo page: `/dashboard/{organizationId}/workflows-demo`
2. Click on the "Manual Configuration" tab
3. You'll see three main sections:
   - **Workflow Configuration**: Define workflow metadata and global settings
   - **Steps Configuration**: Define the workflow steps and their execution order
   - **Execution Control**: Provide input data and execute the workflow

## Configuration Structure

### Workflow Configuration

The workflow configuration defines metadata and global settings:

```json
{
  "name": "My Test Workflow",
  "description": "A workflow executed with manual configuration",
  "version": "1.0.0",
  "config": {
    "timeout": 300000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMs": 1000
    },
    "variables": {
      "environment": "test"
    }
  }
}
```

### Steps Configuration

The steps configuration is an array of step definitions:

```json
[
  {
    "stepSlug": "trigger_1",
    "name": "Manual Trigger",
    "stepType": "trigger",
    "order": 1,
    "config": {
      "type": "manual",
      "context": {}
    },
    "nextSteps": {
      "default": "action_1"
    }
  },
  {
    "stepSlug": "action_1",
    "name": "Test Action",
    "stepType": "action",
    "order": 2,
    "config": {
      "type": "log",
      "message": "Hello from manual workflow execution!",
      "level": "info"
    },
    "nextSteps": {}
  }
]
```

## Step Types

The following step types are supported:

### 1. Trigger Steps

- **stepType**: `"trigger"`
- **Purpose**: Entry point for workflow execution
- **Config Example**:
  ```json
  {
    "type": "manual",
    "context": {}
  }
  ```

### 2. Action Steps

- **stepType**: `"action"`
- **Purpose**: Perform actions like logging, API calls, etc.
- **Config Example**:
  ```json
  {
    "type": "log",
    "message": "Action executed",
    "level": "info"
  }
  ```

### 3. Condition Steps

- **stepType**: `"condition"`
- **Purpose**: Conditional branching based on expressions
- **Config Example**:
  ```json
  {
    "expression": "input.value > 50"
  }
  ```
- **Next Steps**: Use `onTrue` and `onFalse` for branching

### 4. Approval Steps

- **stepType**: `"approval"`
- **Purpose**: Require manual approval to continue
- **Config Example**:
  ```json
  {
    "approverRole": "manager",
    "message": "Please approve this workflow execution"
  }
  ```
- **Next Steps**: Use `onApprove` and `onReject` for branching

### 5. LLM Steps

- **stepType**: `"llm"`
- **Purpose**: AI/LLM processing steps
- **Config Example**:
  ```json
  {
    "name": "Analyze Data",
    "systemPrompt": "You are a data analyst...",
    "userPrompt": "Process this data: {{input}}",
    "temperature": 0.7,
    "tools": [],
    "outputFormat": "json"
  }
  ```
- **Required Fields**: `name`, `systemPrompt`
- **Optional Fields**: `userPrompt` (recommended), `temperature`, `tools`, `outputFormat`, `maxSteps`, `maxTokens`
- **Model Selection**: The model is configured globally via the `OPENAI_MODEL` environment variable (required; no default model is provided) and cannot be customized per step.

## Next Steps Configuration

Each step must define how to proceed to the next step:

- **default**: Default next step (used for most step types)
- **onSuccess**: Next step on successful execution (used for some step types)
- **onTrue**: Next step when condition is true
- **onFalse**: Next step when condition is false
- **onApprove**: Next step when approval is granted
- **onReject**: Next step when approval is rejected

**Note**: Action nodes do not have failure ports. If an action fails, it throws an exception and the workflow execution fails. Use workflow-level error handling (retries, timeouts) instead of per-action failure paths.

## Example Templates

The interface provides three example templates:

### 1. Simple Example

A basic workflow with a trigger and a log action.

### 2. Complex Example

A workflow with conditional branching based on input values.

### 3. Approval Example

A workflow that requires manual approval before proceeding.

## Execution Input

Provide JSON input data that will be available to all steps in the workflow:

```json
{
  "testData": "Manual execution test",
  "timestamp": "2024-01-15T10:30:00Z",
  "value": 75
}
```

## Backend API

The feature uses the `executeWorkflowWithConfig` mutation:

```typescript
const executionId = await executeWorkflowWithConfig({
  organizationId,
  workflowConfig: parsedWorkflowConfig,
  stepsConfig: parsedStepsConfig,
  input: parsedInput,
  triggeredBy: 'manual-config',
  triggerData: {
    triggerType: 'manual-config',
    timestamp: Date.now(),
  },
});
```

## Benefits

1. **Rapid Prototyping**: Test workflow logic without creating database entries
2. **One-off Executions**: Execute workflows for specific scenarios
3. **Development & Testing**: Validate workflow configurations before saving
4. **Debugging**: Test specific step configurations in isolation
5. **Integration Testing**: Verify workflow behavior with different inputs

## Error Handling

The interface validates JSON syntax and provides helpful error messages for:

- Invalid JSON in workflow configuration
- Invalid JSON in steps configuration
- Invalid JSON in execution input
- Missing required fields
- Invalid step type configurations

## Monitoring

After execution, you can monitor the workflow using the standard workflow monitoring tools. The execution will appear in the execution history with the trigger type "manual-config".
