---
title: Automations
description: Build and run multi-step workflows with triggers, conditions, loops, and AI steps.
---

Automations let you define and run multi-step business processes without writing backend code. A workflow is a series of steps. Each step does one thing, and steps are connected to form a complete process.

## Creating a workflow

There are three ways to create a workflow:

### AI-assisted creation

1. Navigate to Automations and click New Automation.
2. Enter a name and a description of what the workflow should do. The more detail you add, the better the AI can build the initial steps.
3. Click Continue. The platform creates the workflow and opens the AI Chat panel on the right where you can refine things in conversation.

### Manual visual editor

1. Create a new workflow as above but leave the description blank.
2. Use the Add Step button on the workflow canvas to add steps one at a time.
3. Configure each step using the side panel that appears when you click on a step.
4. Connect steps by clicking the connector handles and drawing lines between them.

### File-based creation with AI assistance

You can create workflows by adding JSON files to the `workflows/` directory in your project. If you open the project in an AI-powered editor (Claude Code, Cursor, GitHub Copilot, or Windsurf), the editor has full context about workflow schemas, step types, and trigger configuration. Describe what you want the workflow to do and the AI will generate a valid configuration. See [AI-assisted development](/ai-assisted-development) for setup details.

## Step types

| Step type | Color  | What it does                                                                                              |
| --------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Start     | Blue   | The entry point of the workflow. Defines the input schema and when it starts (schedule, event, webhook, or manual run) |
| Action    | Orange | Runs an operation such as create a record, send a message, call an API, or update data                    |
| LLM       | Purple | Sends a prompt to an AI model and passes the response to the next step                                    |
| Condition | Amber  | Checks a condition and routes execution down different branches                                           |
| Loop      | Cyan   | Repeats a set of steps for each item in a list                                                            |
| Output    | Green  | Defines the output mapping for the workflow, determining what data is returned when the workflow completes |

## Triggers

Every workflow needs at least one trigger to know when to run.

### Schedule triggers

Run the workflow on a time schedule. You can enter a cron expression directly or use the AI assistant to generate one from plain English, such as "every weekday at 9am".

All schedules run in UTC. Quick presets are available for every 5 minutes, hourly, daily, weekly, and monthly.

### Event triggers

Run the workflow when something happens in the platform, for example when a new customer is added, a conversation is opened, or a product's stock hits zero. Each event type can have optional filter conditions.

### Webhook triggers

Each workflow gets a unique webhook URL. Sending an HTTP POST to this URL with a JSON body starts the workflow with that data as input. You can add a webhook secret to verify that incoming requests are genuine.

## Workflow configuration

Navigate to a workflow's Configuration tab to adjust:

- Active toggle: enable or disable the workflow. Draft workflows cannot be activated until they are published first.
- Timeout: maximum time in milliseconds a workflow is allowed to run before being stopped. Default is 300,000 ms (5 minutes).
- Max retries: how many times a failed step will be retried before the whole workflow fails. Default is 3.
- Backoff: delay in milliseconds between retry attempts. Default is 1,000 ms.
- Variables: a JSON object of key-value pairs that are available to all steps as shared configuration data.

## Testing a workflow

Use the Test panel, available from the side panel in the workflow editor, to:

- Execute: triggers a real run with test input data. Check the Executions tab to see the result

## Execution history

Navigate to the Executions tab of any workflow to see a log of all past runs, including start time, duration, status, and the input and output data at each step.
