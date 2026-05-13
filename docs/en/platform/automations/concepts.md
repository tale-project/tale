---
title: Automation concepts
description: How workflows, steps, triggers, and variables fit together.
---

An automation is a small, deterministic program that runs when something triggers it. Unlike the chat interface — which is open-ended — automations do exactly what their steps say, in order, every time. They're how you put AI into the background of your business processes.

## Workflow

A workflow is the whole automation. It has a name, a description, a list of steps, one or more triggers, and a set of configuration knobs (timeout, retries, variables).

## Step

A step is one unit of work. The platform ships six step types:

| Step          | Colour | What it does                                                                        |
| ------------- | ------ | ----------------------------------------------------------------------------------- |
| **Start**     | Blue   | The entry point. Defines the input schema and which triggers start the workflow.    |
| **Action**    | Orange | Runs one operation — call an API, query a database, send an email, update a record. |
| **LLM**       | Purple | Sends a prompt to an AI model and passes the response to the next step.             |
| **Condition** | Amber  | Checks a condition and routes down different branches.                              |
| **Loop**      | Cyan   | Repeats a set of steps for each item in a list.                                     |
| **Output**    | Green  | Defines the shape of the data returned when the workflow finishes.                  |

Steps are connected with directional links. Execution follows the links from Start to Output.

## Trigger

A trigger tells the workflow when to run. See [Triggers](/platform/automations/triggers) for the three kinds (schedule, event, webhook) and how to configure each.

## Variables

Variables are shared key-value data available to every step. Useful for API keys referenced by multiple steps, for feature flags that change workflow behaviour, or for constants you don't want to repeat in every step config.

Variables live on the workflow's Configuration tab. They can be read by any step using the `{{ variables.name }}` syntax.

## Draft vs. active

Workflows, like agents, have a draft-and-publish model. A workflow can only be activated once it's been published. Edits after activation create a new draft that runs alongside the live version until you publish again.

## Runs and executions

Every time a trigger fires, the platform creates an **execution**. Executions live on the workflow's Executions tab with start time, duration, final status, and a per-step breakdown of inputs, outputs, and errors. See [Execution logs](/platform/automations/execution-logs).

## Next

Ready to build one? Go to [Workflows](/platform/automations/workflows).
