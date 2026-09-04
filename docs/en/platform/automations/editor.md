---
title: The workflow editor
description: The operating manual for an automation's page — reading the canvas, editing a node, saving a version, running it against mocks, deploying it, and rolling back.
---

This page is the hands-on half of automations: what you click, in what order, to take a change from an idea to the version that triggers run. The model underneath — one document, immutable versions, one deployment, triggers bound to the name — lives on [Automation concepts](/platform/automations/concepts), and this page assumes it. Saving, testing, and deploying are three separate acts here, and keeping them separate is what lets you edit an automation that is live without disturbing a single running job.

## Where an automation lives

Open **Automations** in the sidebar. The list shows every automation in the organization with how many versions it has and either the version that is live or **Not deployed** when it has none yet. Click one and you land on its page.

That page is a workbench rather than a set of tabs. The name carries a **Live** badge when the version on screen is live. **Version**, **Test run**, **Run live**, **Discard**, and **Save** sit on the right — **Deploy this version** sits beside **Version** when the pick is not live. Beside the canvas, the panel shows **Trigger** and **Projects** — which projects' task boards see the automation; none means the whole organization — until you click a box. The panel is as tall as the canvas, which fills the window under the header. Selecting a node does not grow the canvas — extra fields scroll inside the panel. Click **Close**, press Escape, click the selected box again, or click the empty canvas, to get the trigger back. **Versions** and **Runs** sit below.

## Read the canvas

The canvas draws the version on screen. Each box is one node, labelled with its id and its type, and boxes that read another node's output say so — a **Reads** line names the nodes it depends on. The arrows between boxes are not something you draw: an arrow exists because one node's field references another node's output, so the graph always matches the document.

Control flow appears as badges on the box it applies to, in the same vocabulary the document uses — `when …`, `else of …`, `for each …`, `repeat until …` (with the cap shown when there is one), and `continue on error`. Nothing about the shape of the graph is hidden in a separate settings screen.

Two states are worth recognising. A version with no nodes says so and tells you to add one to the document. A version whose nodes reference each other in a circle warns you that the order shown is the order they are written in, not an order the engine could run, and asks you to remove one of the references to break the cycle.

An agent that names a model without a pinned provider shows a warning on its box. Pin the model on the node, save, and deploy.

<Note>

The canvas is for reading and selecting. You wire nodes together by referencing them, not by dragging a connection between two boxes.

</Note>

## Edit a node

Click a box and the panel beside the canvas switches from **Trigger** to that node's fields. Click **Close**, press Escape (when you are not typing in a field), click the box again, or click the empty canvas, to switch back. Which fields appear depends on the node's type: **Code** for a `transform`; **Prompt**, **System prompt**, **Model** and **Output schema** for an `llm`; **Automation** for a `subautomation`; and an `agent` adds its equipment — **Harness**, **Skills**, **Connectors**, **Platform tools**, **Secrets**, and **Staged files** — to the prompt and model it shares with `llm`. **Input** appears for anything that takes one, and the type-specific fields sit above it.

**Input** is a JSON object, and it is where references live. A string value may reference another node's output, and that reference is exactly what draws an arrow on the canvas. While the JSON is incomplete the panel tells you it is not valid yet and leaves the node unchanged, so a half-typed edit can never be saved by accident.

Open **Control flow** for **When**, **Else of**, **For each**, and **Repeat until**. These are the same fields the badges on the canvas reflect, so setting one here changes the badge immediately. The group starts open when any of those is already set.

## Save, run, deploy

The three acts are deliberately separate. Run through them in order the first time and the separation stops feeling like extra work.

<Steps>

<Step title="Save a version">

Edits show an **Unsaved changes** marker until you save. Click **Save**, write a **Version message** saying what changed — that message is the only thing distinguishing two versions in the list later — then confirm **Save version**. The save appends a new version and leaves every earlier one exactly as it was. With nothing changed, the button tells you there is nothing to save rather than minting an identical version.

</Step>

<Step title="Run it against mocks">

**Test run** starts a run in mock mode: connectors return their deterministic stand-ins and nothing outside the platform is touched. It is safe to press repeatedly, which is what makes it the loop to work in while you are still shaping a node.

When the automation is bound to more than one project, a **project scope** selector sits beside the run controls. It defaults to organization-wide; pick one of the bound projects to make the run — and the task and document tools its agents use — act in just that project.

</Step>

<Step title="Deploy the version you want live">

When the canvas version is not live, **Deploy this version** next to **Version** promotes the one on screen. The live one carries a **Live** badge in **Versions**, and deploying a different one moves that badge without touching any version's contents.

</Step>

</Steps>

<Note>

The run control on this page always runs against mocks. A run that may reach the outside world is started by a trigger or by a programmatic call, and starting one is a developer-level action.

</Note>

## Tests and the deploy gate

Tests are part of the document, not a separate panel. Each test carries a name, an input, and expectations about the output and about the effects the run should produce, and they travel with the version like any other field.

```yaml
tests:
  - name: reminds a late payer
    input: { invoiceId: 'inv-1' }
    expect:
      effects:
        - connector: email.send
```

Whether a version's tests passed is recorded at save time, and the **Versions** list shows the result as a **Tests passed** or **Tests failed** badge. Deploying reads that record: a version saved with failing tests is refused, and the page says the version was not deployed rather than silently doing nothing. Fix the cause and save a new version — a recorded result is a fact about that version and never changes.

## Roll back

Rolling back is deploying an earlier version. Pick it from **Version** in the header — or find it in **Versions**, read its message, and click it — then click **Deploy this version**. The badge moves, the newer versions stay in the list untouched, and no document is rewritten.

This is why version messages matter more than they look. Six versions in, the message is what tells you which one was the last good state, so write it for the person who will be reading it during an incident.

## Delete an automation

Deleting removes the automation as a whole: every version, the deployment, the trigger and the project bindings go together — a schedule stops firing and a webhook URL stops working immediately. That happens from the list, not this page: open **Automations**, open the row menu, and click **Delete**. The confirm (**Delete automation**) names it first. Past runs stay readable until retention removes them, so what the automation did remains auditable after it is gone.

Two guardrails apply. A run that is still queued, running or waiting blocks the deletion — cancel it or let it finish first. And a deleted built-in pack stays deleted across platform upgrades; re-creating an automation under the same name brings the name back to life.

## Read the last run on the canvas

Once an automation has run, **Show last run** overlays that run onto the canvas from an icon on the canvas (it reads **Hide last run** while the overlay is on). Every box picks up the status the run gave it — it **Ran**, was **Skipped**, **Failed**, was **Never reached**, or has **Not reached yet** while the run is still going — so a failure is visible as a position in the graph rather than as a line in a log.

Select a node with the overlay on and the panel adds an **In this run** section: the **Resolved input** the node actually received after every template was evaluated, its **Output**, and the effects it produced, or a note that it changed nothing outside the platform. Resolved input is usually the fastest answer to "why did this node do that" — it shows the value a reference produced, not the reference you wrote.

Click a row in **Runs** to open that run's page, where the same canvas sits alongside the run's input, its output, and the complete list of effects. [Execution logs](/platform/automations/execution-logs) reads that page end to end.

## Where this fits

The loop is short once the three acts are clear: edit a node, save a version with a message worth reading, run it against mocks until it does what you meant, then deploy it — and deploy an older version when you need to undo. [Automation concepts](/platform/automations/concepts) is the model this page operates; [Workflow triggers](/platform/automations/triggers) is what starts the deployed version once you are happy with it.
