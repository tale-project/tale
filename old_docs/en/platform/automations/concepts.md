---
title: Automation concepts
description: How automations, steps, triggers, and variables fit together.
---

An automation is a deterministic background program that runs when something asks it to: a clock, an event inside Tale, a webhook from an outside system, or a person clicking **Run**. Where the chat is open-ended and follows the conversation, an automation does exactly what its steps say, in the order they say it, every time it is triggered. The audience for this page is anyone about to build, debug, or read an automation — Developer role or higher, on Cloud or self-hosted.

The vocabulary below — automation, step, trigger, variable, run — is the small set the rest of this section assumes. Read it once and the editor, the **Triggers** tab, and the **Executions** tab all become legible on their own.

## The automation itself

An automation is one named, runnable unit. It owns a list of steps, the triggers that start it, the variables every step can read, and a small set of configuration knobs (timeout, retry count, backoff delay). Publishing, restoring an older version from **History**, and watching a single line on the metrics dashboard are all single-automation moves — the rest of the model is built around the automation as the atom.

## Steps

A step is one unit of work. The editor ships six step types, colour-coded so you can read an automation's shape at a glance.

| Step          | What it does                                                                                |
| ------------- | ------------------------------------------------------------------------------------------- |
| **Start**     | The entry point. Carries the input schema and binds the triggers that start the automation. |
| **Action**    | Runs one operation — call an integration, write to a database, send an email.               |
| **LLM**       | Sends a prompt to a model and passes the response to the next step.                         |
| **Condition** | Branches the path based on a check.                                                         |
| **Loop**      | Runs a sub-sequence once per item in a list.                                                |
| **Output**    | Names the data the automation returns when it finishes.                                     |

Steps are wired together with directional links. Execution walks the links from **Start** to **Output**; **Condition** picks one branch; **Loop** repeats its inner block per list item.

## Triggers

A trigger names the moment the automation starts and what input it starts with. Tale ships three flavours — **Schedules** for clock-driven runs, **Webhooks** for runs kicked off from outside the platform, and **Events** for runs reacting to something that happened inside Tale (a new customer, a closed conversation, another automation finishing). One automation can carry multiple triggers of any kind, so the same fan-out can run on a nightly schedule and on every inbound webhook. The details — cron syntax, the webhook URL, the supported event types — are at [Triggers](/platform/automations/triggers).

## Variables

Variables are the shared key-value bag every step can read. They are where you keep the API key three steps reference, the feature flag that flips behaviour between staging and production, or the constant you do not want pasted into five step configurations. They live on the **Configuration** tab and are read inside any step with the `{{ variables.name }}` syntax.

## Runs

Every time a trigger fires, the platform creates a run on the **Executions** tab. A run carries the trigger source, the start and end time, the final status, and a per-step record of the input it saw, the output it produced, and any error it threw. This is the artefact you open when a third-party API returned `400` and you want the literal request body that produced it — see [Execution logs](/platform/automations/execution-logs).

## When to reach for it

Automations and agents are the two ways Tale runs AI work; pick by where the human sits.

| Reach for an automation when …                              | Reach for an agent when …                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| A schedule, a webhook, or a system event starts the work    | A person is asking a question and waiting for a written answer        |
| The flow is the same every run — same steps, same order     | The flow branches on the reply; the next move depends on intent       |
| The output is a write to another system, an email, a ticket | The output is text the person reads, or a small structured payload    |
| You want a per-run trace of every input, output, and error  | You want a conversation transcript with the model's reasoning in-line |

The two compose. An automation's **LLM** step can adopt an agent's instructions and tool list; an agent can hand a long-running job off to an automation through the integration tool. Pick the primary by whether a human is in the loop when the work starts.

## Build one

The five nouns on this page — automation, step, trigger, variable, run — are the entire model. The next page is the editor that turns them into something runnable: [Automations](/platform/automations/workflows).
