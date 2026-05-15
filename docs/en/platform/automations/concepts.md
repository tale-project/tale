---
title: Automation concepts
description: How workflows, steps, triggers, and variables fit together.
---

An automation is a small, deterministic program that runs when something triggers it. Unlike the chat interface — which is open-ended — automations do exactly what their steps say, in order, every time. They put AI into the background of a business process: nightly imports, inbound webhook fan-outs, scheduled summaries, anything that has to happen without a human in the chat.

This page is for anyone about to build, debug, or read an automation — Developer role or higher, on either edition. The pieces below — workflow, step, trigger, variable — are the small vocabulary the rest of this section assumes. Read them once and the editor, the trigger config, and the execution logs all become navigable on their own.

## Workflow

A workflow is the whole automation. It has a name, a description, a list of steps, one or more triggers, and a small set of configuration knobs (timeout, retries, variables). One workflow is one runnable unit; you publish, version, and observe it as a single thing.

## Step

A step is one unit of work. The platform ships six step types, each colour-coded in the editor so a workflow's intent is readable at a glance:

| Step          | Colour | What it does                                                                        |
| ------------- | ------ | ----------------------------------------------------------------------------------- |
| **Start**     | Blue   | The entry point. Defines the input schema and which triggers start the workflow.    |
| **Action**    | Orange | Runs one operation — call an API, query a database, send an email, update a record. |
| **LLM**       | Purple | Sends a prompt to an AI model and passes the response to the next step.             |
| **Condition** | Amber  | Checks a condition and routes down different branches.                              |
| **Loop**      | Cyan   | Repeats a set of steps for each item in a list.                                     |
| **Output**    | Green  | Defines the shape of the data returned when the workflow finishes.                  |

Steps connect with directional links. Execution follows the links from Start to Output; branches inside a Condition are followed independently; Loop steps repeat their inner block per list item.

## Trigger

A trigger tells the workflow when to run. The platform supports three kinds: a schedule (cron-style), an event (something happened inside Tale), and a webhook (an external system called us). One workflow can have multiple triggers — the same fan-out runs on a nightly schedule _and_ whenever a webhook fires. See [Triggers](/platform/automations/triggers) for the details on each kind and the syntax for configuring them.

## Variables

Variables are shared key-value data available to every step. They are useful for API keys referenced by multiple steps, for feature flags that change workflow behaviour, and for constants you don't want to repeat in every step config. Variables live on the workflow's Configuration tab and are read by any step using the `{{ variables.name }}` syntax.

## Draft vs. active

Workflows, like agents, have a draft-and-publish model. A workflow can only be activated once it has been published. Edits after activation create a new draft that runs alongside the live version until you publish again — so you can rework a step without taking the active automation down.

## Runs and executions

Every time a trigger fires, the platform creates an **execution**. Executions live on the workflow's Executions tab with start time, duration, final status, and a per-step breakdown of inputs, outputs, and errors. The Execution log is where you debug failures: every step records its input, its output, and any thrown error, so a `400 Bad Request` from a third-party API is one click away from the literal payload that produced it. See [Execution logs](/platform/automations/execution-logs).

## When to reach for it

Automations are the deterministic background primitive in Tale. Their sibling is the **agent** — the conversational primitive that runs synchronously with a human in the chat. Pick by where the work happens.

| Use an automation when …                                          | Use an agent when …                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| A schedule, a webhook, or an internal event fires the work        | A human is asking a question and waiting for an answer           |
| The flow is the same every time — same steps, same order          | The flow branches on each reply; the next step depends on intent |
| The output is an effect on another system (DB row, email, ticket) | The output is a written answer or a small structured payload     |
| You want a paper trail of every input, output, and error          | You want a conversational record with model decisions inline     |

The two compose. A workflow's LLM step can call an agent's instructions; an agent can hand off a long-running job to an automation via the integration tool. Pick the primary primitive based on whether the user is in the loop when the work starts.

## Build one

The vocabulary above is the whole model. The next page is the editor that turns it into a runnable workflow: [Workflows](/platform/automations/workflows).
