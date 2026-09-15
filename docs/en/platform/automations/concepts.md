---
title: Automation concepts
description: Understand workflow steps, saved versions, deployment, triggers, and the history of each run.
---

Use an automation for work that follows a repeatable process. Its workflow describes the steps; saved versions preserve each revision, deployment chooses the version used for live runs, and a trigger can start it on a schedule or event. You can inspect each run to see its input, results, and operations.

Prefer to watch first? Episode 5 opens the triage automation end to end and decides an approval card on camera, captions included — recorded on the earlier version, where the card sat in chat; in this version it sits on the run's detail page.

<Video src="/videos/en/tutorials/ep5-automations/ep5-automations.en.mp4" poster="/videos/en/tutorials/ep5-automations/ep5-automations.en.webp" captions="/videos/en/tutorials/ep5-automations/ep5-automations.en.vtt" lang="en" title="Episode 5 — Automations & approvals" caption="Episode 5 — Automations & approvals (2:42)">

</Video>

## The workflow document

An automation’s `name` identifies it. Use lowercase slug segments separated by dashes; `/` groups related automations into folders, as in `billing/dunning-reminder`. The first segment must not be a reserved page name: `asks`, `builder`, `catalog`, `listing`, `metrics`, `runs`, `serving-preview`, or `upload`.

The document also contains a `description`, an `inputs` JSON Schema for the data a run receives, `nodes` for the steps, and an `output` expression for the result. Its `tests` describe examples and expected outcomes that are checked before deployment.

```yaml
name: billing/dunning-reminder
description: Remind a customer about an overdue invoice.
inputs:
  type: object
  properties:
    invoiceId: { type: string }
  required: [invoiceId]
nodes:
  - id: invoice
    type: transform
    input:
      id: '{{ input.invoiceId }}'
    code: 'return { id: input.id, daysLate: 14 };'
  - id: message
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Write a polite reminder for invoice {{ nodes.invoice.output.id }}.'
output:
  text: '{{ nodes.message.output.text }}'
tests:
  - name: builds a reminder
    input: { invoiceId: 'inv-1' }
```

The `ui` block stores canvas positions. Moving a node changes the layout, without changing its execution.

### Edges are derived, not declared

There is no edge list. One node reads another by referencing it — `{{ nodes.invoice.output.id }}` — and that reference _is_ the edge the canvas draws. Execution order is a topological sort over those derived edges, which is why deleting a reference also removes an arrow, and why two nodes that read each other are refused as a cycle.

Templates use a single `{{ }}` JavaScript-expression grammar over `input`, `nodes.<id>.output`, and, inside an iterating node, `item` and `index`.

### Control flow rides on the node

Branching and looping are fields on a node rather than separate step types, so the canvas shows them as badges on the box they affect.

| Field                        | What it does                                                             |
| ---------------------------- | ------------------------------------------------------------------------ |
| `when`                       | Run the node only when the expression is truthy; dependents skip with it |
| `elseOf`                     | Run exactly when the named node was skipped by its own `when`            |
| `forEach`                    | Run once per item of a collection, with `item` and `index` in scope      |
| `repeatUntil` / `maxRepeats` | Re-run until the expression is truthy, capped (default 5, maximum 20)    |
| `onError`                    | `fail` halts the run; `continue` records the error and skips dependents  |

### Node types

Four types are built in, and every connector action and platform native — knowledge search, document operations — joins the same table alongside them.

**`transform`** runs pure JavaScript to reshape data. It has no network and no imports: the body reads the node's resolved `input` and must return a value.

**`llm`** calls a language model with a templated prompt. `model` is required and always explicit — an automation never picks one on your behalf (the chat composer's Auto is a chat-only affordance). The output is `{text}`, or the schema-shaped object when the node declares an `outputSchema`.

**`agent`** runs one turn of a coding agent (Claude Code, Codex, and the other harnesses) in the sandbox. It reads staged `files`, uses `skills`, brokered `connectors`, granted platform `tools`, and injected `secrets`, and returns `{text, files, status}`; `model` is required. Reach for `llm` when a one-shot completion is enough, and for `agent` only when the step needs tools, files, or several turns — a live agent node runs as an asynchronous turn, so it sits at the top level rather than inside a `subautomation` and does not iterate with `forEach`.

**`subautomation`** runs another saved automation as a single node, its `automation` field naming `"name"` or `"name@version"`. Without a version it uses the deployed one, and nesting is capped at three levels.

### Structured and unstructured output

A **structured** output has named fields that you can reference with `nodes.<id>.output.<field>`. An **unstructured** output is free text. Reference it through `nodes.<id>.output.text` in a string expression; do not treat it as an object with additional fields.

A tool without an output schema is unstructured. To turn its text into structured data for later steps, use an `llm` node with an `outputSchema`. Validation errors identify the invalid reference and the fields or context that are allowed. Correct that reference before saving again.

## Versions never change

Saving creates a new version instead of overwriting the previous one. Versions are numbered from 1 for each automation and carry the author’s change message. An existing version’s workflow stays unchanged.

A running automation keeps the version it started with, so later edits do not alter its steps. When inspecting an older run, open its recorded version to compare the input and workflow. This immutability is distinct from retention: deleting an automation or its history can remove the records.

## Deploying is a separate act

One version per automation is the deployed one, and that is the version triggers run. Promoting a version, or rolling back to an earlier one, is a single act that overwrites no history — the version list stays exactly as it was and only the pointer moves. An automation may also have no deployment at all and live purely as drafts.

A version becomes deployable only once its own tests pass. Tests are stored with the document: each has a name, an input, and expectations about the output and about the effects the run should produce. Whether a version's tests passed is recorded when it is saved, so promoting reads that recorded fact instead of re-running the suite.

<Note>

A live run needs a deployed version. You can still test a saved draft with **Test run** before deployment.

</Note>

## What starts a run

Start a saved version manually in test mode, or run the deployed version live. For automatic starts, configure one of three trigger kinds: a schedule with a cron expression and IANA timezone, a webhook URL protected by a token, or a named platform event.

The trigger belongs to the automation’s name. Deploying another version keeps its trigger configuration and webhook URL while changing the version used by subsequent starts. Disable the trigger when you need to pause automatic runs. [Workflow triggers](/platform/automations/triggers) explains timing, authentication, and the input each kind supplies.

## What a run records

A run records its status (`queued`, `running`, `waiting`, `success`, `failed`, or `cancelled`), mode, starting event, input, output, and a checkpoint for each completed node. Its trace explains the steps the engine attempted.

If processing yields before the workflow finishes, the same run resumes from its checkpoints without repeating completed nodes. The effects list records connector writes; it is not a complete inventory of changes made through a sandbox or other direct tools. Run history remains subject to deletion and retention settings.

**Mock** mode simulates external operations for authoring feedback. **Live** mode can perform them and requires developer-level permissions to start. Use [Execution logs](/platform/automations/execution-logs) to inspect the saved version, resolved inputs, errors, and recorded effects.

## Where a human decides

An approval pauses the run in `waiting` before a protected write. Approving permits the engine to attempt that write; it does not guarantee success. Rejecting blocks it and fails the run. A question also pauses the run, but asks for information rather than permission.

A `waiting` status can also mean that an agent is still working or a node is polling a condition. Check `waitingFor`: `approval` and `ask` require a person, while `agent` and `repeat` normally resume automatically. [Approvals in workflows](/platform/automations/approvals-in-workflows) explains how to inspect and answer each human request.

## Choose a chat, task, or automation

| Need | Use |
| --- | --- |
| Ask a question and discuss the answer | Chat |
| Produce a reviewed result with an owner | A project task, optionally assigned to an agent |
| Run several dependent steps or react to a schedule, webhook, or event | An automation |

Check the [built-in automations](/platform/automations/builtin) before building. A webhook starts an automation; it is not a separate kind of project agent.

## Putting the model to work

The workflow, versions, deployment, and trigger are separate parts of one automation. Follow [The workflow editor](/platform/automations/editor) to test and deploy a change; use [Execution logs](/platform/automations/execution-logs) to inspect what happened.
