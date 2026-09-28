---
title: The workflow editor
description: Inspect and edit nodes, supply test input, save a version, and deploy or roll back an automation.
---

Use the workflow editor to change what an automation does and decide which saved version runs live. You need Developer, Admin, or Owner permissions to make changes. Saving, testing, and deployment are separate steps: editing a draft leaves the deployed version in place.

Open **Automations**, then select an automation. It opens on **Editor**. To create one first, use [Create or import an automation](/platform/automations/catalog).

| Tab | Use it to |
| --- | --- |
| **Editor** | Change the workflow, test a saved version and choose what runs live. |
| **General** | Choose what starts the automation and which projects can use it. |
| **Runs** | Inspect recent executions and open a run’s full record. |

The **Version** selector stays at the right of the Editor, General and Runs tabs on desktop and mobile. Open it to read version messages, dates, test results and the live marker, then select a row to open that version. On desktop, run actions sit beside the tabs together with **Save** and **Discard**; on **General**, only **Save** and **Discard** sit there. A dot on a tab marks its unsaved changes. Leaving the tab or switching versions asks you to resolve those changes first.

On a phone, opening an automation starts with compact navigation. The editor canvas fills the available height, and its run and deploy controls sit inside the canvas beside the zoom controls. Selecting a node opens its fields — and Save and Discard — in a panel at the bottom of the screen.

<Frame caption="On a wide screen, select a node to inspect its fields beside the canvas.">

![The workflow editor shows connected nodes and the selected node’s fields beside the canvas.](/images/platform/automation-editor-canvas.webp)

</Frame>

To switch without returning to the list, click the current automation's name in the breadcrumb trail. The menu includes every automation in the organization, even after switching to another project. Automations with no project assignments appear first, followed by those assigned to projects, with a horizontal divider between the two groups. Search by name or slug and select an entry. The switch keeps the current tab; from a run’s detail, it opens the other automation’s **Runs** list. A selected version number does not carry over: **Editor** opens the other automation’s latest saved version.

## Read the canvas

Each box is a node. Its label identifies the step and type; **Reads** lists the nodes whose outputs it uses. Arrows come from references such as `{{ nodes.draft.output.text }}`. Edit the reference to change the dependency. The canvas does not create dependencies by drawing an arrow.

Badges show conditions and loops: `when`, `else of`, `for each`, `repeat until`, and `continue on error`. A cycle warning means two or more nodes depend on one another; remove the circular reference before saving a runnable version.

## Edit a node

Select a box to open its fields. On a wide screen, the panel opens beside the canvas; until you select a node, the canvas takes the full width. On narrower screens, the fields open in a dialog over the canvas. A `transform` has **Code**; an `llm` has prompt, model, and output-schema fields; an `agent` also has harness and equipment. The **Model** picker of an `llm` or `agent` node lists the models your organization’s connected providers serve; a model that is not listed can still be typed, but validation warns that a live run would fail at that node until its provider is connected. **Input** contains JSON values and references passed to the node. Incomplete JSON is reported and does not update the node.

Open **Control flow** for conditions and iteration; it is already open on a node that has one. Use **Close** to return to the canvas. On a wide screen, clicking the empty canvas or pressing Escape outside a text field also closes the panel. The automation's trigger and project settings are on the **General** tab. [Automation concepts](/platform/automations/concepts) explains the node types and expression rules.

## Save and test a version

1. Edit the required fields and click **Save**.
2. Enter a **Version message** that explains the change, then **Save version**. This appends a version and preserves earlier ones. If someone saved another version while you were editing, Tale refuses the save and asks: **Discard my changes and reload** shows the newer version, **Save anyway** appends your version on top of it — the newer one stays in the version history, but the latest version is then yours.
3. Click **Test run**. If the workflow declares an input schema, fill **Run input (JSON)** in the dialog. Expand **Input schema** to inspect required fields and types. Invalid JSON or a schema mismatch prevents the start.
4. Start the test, switch to the **Runs** tab and inspect its row. Open it to compare the resolved input, output, and proposed operations with your expected result.

For a workflow requiring `owner` and `repo`, an input might be:

```json
{
  "owner": "your-organization",
  "repo": "your-repository"
}
```

Use the workflow's actual schema. A field typed as a number must receive a JSON number, not a quoted string. Where a project selector is offered, check the scope before starting.

**Test run** uses the selected saved version with deterministic mocks. It does not send mail or change external records. A draft can be tested before it is deployed; a successful mock does not verify live credentials or outside services.

<Frame caption="For an input-driven workflow, supply JSON and inspect its schema before starting the test.">

![The Test run dialog shows owner and repo JSON values and the expanded input schema.](/images/platform/automation-run-input.webp)

</Frame>

## Deploy and run live

Choose the tested version under **Version** and click the deploy button beside it, which names that version, such as **Deploy v3**. The **Live** badge marks the deployed version. A version whose saved tests failed cannot be deployed; correct the cause and save a new version.

**Run live** starts the deployed version, even if you are viewing another one. Its confirmation shows the scope and, when required, **Run input (JSON)** for that deployed version. Check both before confirming. Live runs may act on connected systems and may wait for an [approval](/platform/approvals/concepts).

A trigger also runs the deployed version. Set it up only when you are ready for repeated or externally initiated execution; see [Automation triggers](/platform/automations/triggers).

## Diagnose a result

**Show last run** overlays run states on the canvas. Select a node to see **In this run**, its **Resolved input**, **Output**, and effects. This is often enough to find a wrong reference: compare the input received by the failed node with the output of the node it reads.

Switch to **Runs** and open a row for the full record. The tabs remain visible with **Runs** active; **Editor** returns to the workflow. Check whether it was a test or live run and inspect already completed operations before starting another run. [Execution logs](/platform/automations/execution-logs) explains waiting, failures, automatic retries, and stopping.

## Roll back or delete

To roll back, open **Version** at the right of the tab strip, read the version messages and select an earlier version. Its row opens **Editor** at that version; click its deploy button there, such as **Deploy v2**. Future starts use it; version history remains intact. A version message such as “Restore the previous recipient mapping” makes that choice easier to review.

To delete the automation, return to the list, open its row menu, and select **Delete**. Read the named confirmation. All versions, deployment, trigger, and project bindings are removed. An unfinished run blocks deletion; stop it or let it finish first. Past runs remain subject to retention. Deleting an automation does not undo the actions its runs already performed.
