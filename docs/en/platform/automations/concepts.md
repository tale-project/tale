---
title: Automation concepts
description: The model behind every automation — one workflow document, a version history that never changes, a single deployed version, the triggers that start it, and the runs it records.
---

An automation is one saved workflow document under a name, plus everything the platform keeps around it: the history of that document's versions, the single version that is live, the triggers allowed to start it, and the record of every run. Open **Automations** in the sidebar and each row is one of those names, with the version that is live beside it. Three ideas on this page decide how the rest of the surface behaves — versions never change, deploying is a separate act, and a trigger binds to the name rather than to a version — so read them before you build anything.

Prefer to watch first? Episode 5 opens the triage automation end to end and decides a real approval card on camera, captions included.

<Video src="/videos/en/tutorials/ep5-automations/ep5-automations.en.mp4" poster="/videos/en/tutorials/ep5-automations/ep5-automations.en.webp" captions="/videos/en/tutorials/ep5-automations/ep5-automations.en.vtt" lang="en" title="Episode 5 — Automations & approvals" caption="Episode 5 — Automations & approvals (2:42)">

</Video>

## The workflow document

Everything an automation does is declared in one document. Its `name` is also its identity — lowercase slug segments, dash-separated, with `/` grouping related automations into folders, as in `billing/dunning-reminder`. Around the name sit a `description`, an `inputs` JSON Schema describing the runtime input, the `nodes` that do the work, an `output` that is the automation's return value, and the `tests` that decide whether a version may be deployed.

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

Canvas positions ride along in a `ui` block the engine ignores, so dragging a box around never changes behaviour.

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

Three types are built in, and every integration action and platform native — knowledge search, document operations — joins the same table alongside them.

**`transform`** runs pure JavaScript to reshape data. It has no network and no imports: the body reads the node's resolved `input` and must return a value.

**`llm`** calls a language model with a templated prompt. `model` is required and always explicit — the platform never picks one on your behalf. The output is `{text}`, or the schema-shaped object when the node declares an `outputSchema`.

**`subworkflow`** runs another saved automation as a single node, referenced as `"name"` or `"name@version"`. Without a version it uses the deployed one, and nesting is capped at three levels.

### Structured and unstructured output

Every node type's output is one of two kinds, and this is the rule authors hit most. A **structured** output is a typed shape you may path into with `nodes.<id>.output.<field>`. An **unstructured** output is free text: only `nodes.<id>.output.text` exists, and only in string context. A tool that declares no output schema is unstructured by definition, and the one sanctioned bridge from text to structured data is an `llm` node with an `outputSchema`.

Validation refuses the mistake instead of letting it surface at run time, and every error carries a machine-readable code plus a hint naming what is actually available. Reading that hint is how you discover the shape you meant to reference.

## Versions never change

Saving appends a new version; it never edits an existing one. Versions are numbered from 1 and stay contiguous per automation, and each carries the message its author wrote about what changed. Version 3 of an automation is therefore the same document forever.

Two things follow. Editing an automation cannot disturb what is already running, because the running version is a different row. And a run that failed last month can be read against the exact document that produced it, because that document still exists untouched.

## Deploying is a separate act

One version per automation is the deployed one, and that is the version triggers run. Promoting a version, or rolling back to an earlier one, is a single act that overwrites no history — the version list stays exactly as it was and only the pointer moves. An automation may also have no deployment at all and live purely as drafts.

A version becomes deployable only once its own tests pass. Tests are stored with the document: each has a name, an input, and expectations about the output and about the effects the run should produce. Whether a version's tests passed is recorded when it is saved, so promoting reads that recorded fact instead of re-running the suite.

<Note>

An automation with no deployed version cannot be started at all — not by a trigger, not by hand. Save a version, then deploy it.

</Note>

## What starts a run

A trigger says what is allowed to start an automation, and there are exactly three kinds: a **schedule** (a cron expression read in a named IANA timezone), a **webhook** (an inbound URL guarded by a token), and an **event** (a platform event name).

A trigger binds to the automation's **name**, never to a version. Deploying a new version therefore never invalidates a webhook URL an external system depends on, and never drops a schedule someone is relying on. Each trigger can be switched off and back on without being lost, and each records when the scheduler last acted on it. [Workflow triggers](/platform/automations/triggers) covers what each kind carries into the run.

## What a run records

A run is a durable object, not a log line. It holds its status — `queued`, `running`, `waiting`, `success`, `failed`, or `cancelled` — its mode, what started it, the input it received, the output it produced, and a **checkpoint for every completed node**.

Those checkpoints are the point. A live run steps node by node, and when it reaches the platform's action time window it hands itself back and resumes from the last completed node instead of repeating side effects already performed. A run also keeps the engine's full trace and the ordered list of effects it produced, which is what lets the canvas replay it and what keeps every outside change auditable afterwards.

Runs come in two modes. **Mock** never touches the outside world and is the fast feedback loop while you author. **Live** may, which is why starting one is a developer-level action. [Execution logs](/platform/automations/execution-logs) reads a run end to end.

## Where a human decides

A run that needs an approval does not fail and does not restart. It pauses in `waiting`, and when the approval is answered it re-enters at the node it stopped on, carrying the answer forward. A run waiting on human input behaves the same way. [Approvals in workflows](/platform/automations/approvals-in-workflows) covers the gates and what each decision leaves behind.

## Choosing the right unit

| Reach for …                                                        | Automation | Agent | Agent webhook |
| ------------------------------------------------------------------ | ---------- | ----- | ------------- |
| Work with several steps, branches, schedules, or approvals between | ✓          |       |               |
| Something that must run on a clock or answer a webhook             | ✓          |       |               |
| A recurring question in chat, with no external system involved     |            | ✓     |               |
| One agent reply per incoming POST                                  |            |       | ✓             |

Check the catalog before building — the automation you need may already ship. A [webhook trigger](/platform/automations/triggers) is the inbound seam; reach for it when an external payload should start a run.

## Putting the model to work

An automation is one document, kept as an unbroken chain of versions, with exactly one of them deployed and a set of triggers bound to its name rather than to any version — which is what makes editing safe, rollback cheap, and a failed run reproducible. [The workflow editor](/platform/automations/editor) is the hands-on manual for saving, testing, deploying, and rolling back; [Browse and install automations](/platform/automations/catalog) is the route to the ones that already ship.
