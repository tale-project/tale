---
title: The workflow editor
description: Read an automation on its canvas, follow its possible paths, edit node fields, save a version, and deploy or roll back.
---

Use the workflow editor to read what an automation does, change its fields, and decide which saved version runs live. Larger changes, such as new nodes, come from a coding agent through MCP. You need Developer, Admin, or Owner permissions to make changes. Saving, testing, and deployment are separate steps: editing a draft leaves the deployed version in place.

Open **Automations**, then select an automation. It opens on **Editor**. An automation you open from a project's **Automations** tab shows that project at the start of the breadcrumb trail: choose the project's name to return to the project, or **Automations** to return to its automations. Whether you open an automation from a project or from the automation list, the rail marks **Automations**. To create one first, use [Create or import an automation](/platform/automations/catalog).

| Tab | Use it to |
| --- | --- |
| **Editor** | Read and change the workflow, test a saved version and choose what runs live. |
| **General** | Choose what starts the automation and which projects can use it. |
| **Runs** | Inspect recent executions and open a run’s full record. |
| **Versions** | See what is live, every saved version and every deployment, and deploy, roll back or restore a version. |

The **Version** selector stays at the right of the Editor, General and Runs tabs on desktop and mobile. Open it to read each version's message, who saved it and when, its test result and the live marker; **Restores v3** and **Based on v1** mark a version restored from, or built on, an older one. Select a row to open that version. **All versions and changes** at the foot of the list opens **Versions**, which shows the whole history; see [Versions and deployments](#versions). On desktop, run actions sit beside the tabs together with **Save** and **Discard**; on **General**, only **Save** and **Discard** sit there. A dot on a tab marks its unsaved changes. Leaving the tab or switching versions asks you to resolve those changes first.

On a phone, opening an automation starts with compact navigation. The editor canvas fills the available height, and its run and deploy controls sit in a toolbar at the bottom of the canvas. Selecting a node opens its fields — and Save and Discard — in a panel at the bottom of the screen.

<Frame caption="On a phone, the canvas takes the height of the screen, and its run controls sit in a toolbar at its foot.">

![The editor of Triage the Gmail inbox on a phone: compact navigation with Editor, General and Runs, the canvas with Start, Inbox and Due, and a toolbar at the foot of the canvas with Deploy v1, Test run, Change model, No problems and Tests.](/images/platform/automation-editor-canvas-mobile.webp)

</Frame>

<Frame caption="On a wide screen, select a node to inspect its fields beside the canvas.">

![The workflow editor shows the nodes of Gmail triage inbox between Start and End, a condition in words above one node, and the selected node’s fields beside the canvas.](/images/platform/automation-editor-canvas.webp)

</Frame>

To switch without returning to the list, click the current automation's name in the breadcrumb trail. The menu includes every automation in the organization, even after switching to another project, except one bound only to projects you cannot open. Automations with no project assignments appear first, followed by those assigned to projects, with a horizontal divider between the two groups. Search by name or slug and select an entry. The switch keeps the current tab; from a run’s detail, it opens the other automation’s **Runs** list. A selected version number does not carry over: **Editor** opens the other automation’s latest saved version.

## Read the canvas

Tale draws the canvas from the automation's document and arranges it for you: **Start** sits at the top, **End** at the bottom, and every node sits below the nodes it reads, so the canvas reads from top to bottom in the order a run goes. Nobody places a box, and drawing does not connect anything. A line comes from a reference such as `{{ nodes.draft.output.text }}`; to change what a node reads, change the reference.

### Start and End

**Start** says what starts a run and what it receives. Under **Starts**, it lists the trigger in words, such as a schedule with its time zone and next run, and says when the trigger is off or waits for a live version. **By hand, the API or MCP** follows, because those starts are always possible. Under **Input**, it lists the fields of the run input with their type and whether they are required. When the trigger would start runs whose input the automation refuses, Start says so.

**End** says what a successful run returns and how a run can end. Under **Returns**, it names the output, such as **The output of Report**, or lists its fields and the nodes they come from; a field that is empty on some runs says **may be empty**. Under **Ends**, it lists the three outcomes: **Succeeded** returns the output, **Failed** happens when one of the nodes that stop the run fails, and **Stopped** happens when someone stops the run.

### Nodes

Each node is a box. Its first line shows the node's icon and its title, made from its ID: `open_issues` reads **Open issues**. The next line says what kind of node it is: the connector and action, such as **GitHub · List issues**, **Transform**, **Language model** or **Agent** with its model, or the automation it calls. When Tale knows what the node returns, a line shows the shape, such as `{ issues: object[] }`. The bottom line says what the node reads, such as **Reads Issues and run input (owner, repo)**, or **Reads no other node**.

Chips and small icons add what the layout cannot show. **Continues on error** marks a node whose failure the run tolerates, and **Never runs** a node that no combination of conditions reaches. A shield marks a node that changes data in a connected service, where a live run may wait for an approval; a speech bubble marks an agent that may ask a question; a crossed-out pin marks a model with no pinned provider. Point at an icon to read its sentence; a screen reader hears it with the box. A box with problems shows their counts in its first line.

### Conditions and branches

A node's condition (`when`) stands above it as a pill that says the condition in words, such as "total of Score is greater than 1,000". The node below runs only if the condition holds. When another node is its alternative (`elseOf`), the condition splits into two lines: **Yes** leads to the node on the left, which runs when the condition holds, and **No** leads to its alternative on the right. A condition that Tale cannot put into words shows the expression itself, in code type.

```yaml
nodes:
  - id: escalate
    type: transform
    when: '{{ nodes.score.output.total > 1000 }}'
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "Escalate " + input.total };'
  - id: file
    type: transform
    elseOf: escalate
    input: { total: '{{ nodes.score.output.total }}' }
    code: 'return { text: "File " + input.total };'
```

In this excerpt, the condition above Escalate reads "total of Score is greater than 1,000", **Yes** leads to Escalate and **No** to File. Point at a condition, or at its **Yes** or **No**, to light up the paths through it.

### Lines, frames and dashed boxes

A solid line means the lower node reads the output of the upper one. A dashed line means the lower node runs after the upper one without reading its output, as when its condition reads it. A dotted line into End leaves the last node of a run whose output End does not return. The **Yes** and **No** lines have their own colours.

A frame around a node says it runs more than once: once per item of a list (**For each item of …**) or again until a condition holds (**Repeats until …, at most 5×**). A dashed box is a node that may not run; after a run, it is a node that didn't run. **Legend**, beside the zoom controls, explains each kind of line and box.

### Keyboard and the List view

The chart is one stop in the Tab order. Tab to it and the focus lands on Start; the arrow keys follow the lines from box to box and move along a row, Home and End jump to Start and End, and Enter opens the box in focus. A screen reader hears each box's title, its kind and what it reads; for a condition, it hears which node the condition decides on.

The view switch at the top left of the canvas changes between **Canvas**, **List** and **Source**. **List** shows the same nodes in run order, each with what it reads and its condition in words, and Enter opens a node from there too. When the canvas is very narrow, it starts in **List**. The address keeps the view and the open node, so a link you share opens both.

### When a new version arrives {#new-versions}

Someone can save a new version while you look at the automation, for example a coding agent through MCP. If you are looking at the latest version and have no unsaved changes, the canvas switches to the new one: boxes glide to their new places, new boxes fade in, changed ones are ringed once, and a screen reader hears "Now showing v6.". The node you had open stays open if it still exists. If you have unsaved changes, nothing moves. A notice above the canvas says **A newer version was saved**, which version your draft is based on, who saved the new one and what it changed. **See what changed in v6** opens the comparison in a new tab, so your draft stays open, and **Show v6 and discard my draft** switches to the new version.

## Follow the possible paths {#paths}

A run's conditions decide which nodes run. The paths button at the top right of the canvas counts the ways a successful run can go, such as **3 paths**, and opens **Possible paths**. Each path names the conditions that decide it, such as "Triage runs" or "Propose fails, the run goes on", and how many nodes run on it.

Point at a path, or move to it with the arrow keys, to preview it on the canvas. Click it or press Enter to keep it shown: nodes off the path turn dashed and say why they don't run, End marks the outputs that stay empty on that path, and a screen reader hears which path is shown. **Show all**, or Escape, shows every node again. The list stays open while you select nodes, so you can compare a path with a node's fields.

<Frame caption="Three ways a run of the Gmail triage can go; Path 2, kept shown, is the one where Propose fails and the run goes on.">

![Possible paths open beside the canvas of Triage the Gmail inbox: Path 1 runs 6 of 6 nodes; Path 2, pinned, runs 5 of 6 nodes because Triage runs and Propose fails while the run goes on; Path 3 runs 1 of 6 nodes because Triage is skipped. Below them, Ends the run when it fails says what makes Inbox fail.](/images/platform/automation-editor-paths.webp)

</Frame>

Under **Ends the run when it fails**, the list names the nodes whose failure stops the run, with what can make each one fail. Point at one to ring all of them in red; select one to open it.

On a phone, the list opens in a panel at the bottom of the screen. Choosing a path closes the panel and leaves a pill at the top of the canvas that names the path, with **Show all**. When every run takes the same path, the list says so. An automation with more than 12 conditions and tolerated failures has too many paths to list; each node's **When it runs** still says when it runs. A canvas with a cycle has no paths button. [Paths a run can take](/platform/automations/concepts#paths) explains how Tale works the paths out.

## Edit a node

Select a box to open it. On a wide screen, the inspector opens beside the canvas; until you select a node, the canvas takes the full width. On narrower screens, it opens in a panel over the canvas. Its header shows the node's title, its kind, and its ID with **Copy node ID**; problems that belong to the node are listed under it. **When it runs** sums up the node's place in the flow: on every run, on some of the paths or never, why it can be skipped, and what happens when it fails, such as "If it fails, the run stops with its error."

Three tabs follow:

- **Fields** holds what you can change. A `transform` has **Code**; an `llm` has **Prompt**, **System prompt**, **Model** and **Output schema**; an `agent` also has its agent runtime and equipment. **Input** contains the JSON values and references passed to the node.
- **Shape** shows what the node receives and returns, where Tale got that shape from, and which nodes read its output. Select a reader to open it. **Show as TypeScript** shows the same shape as a type.
- **Last run** shows the node's **Resolved input**, **Output** and effects in the run shown on the canvas. It appears while the canvas shows a run, and is named **Unsaved test** for a [try of the draft](#try-the-draft) and **In this test** for a test's run.

<Frame caption="The Shape tab: what Triage returns, where that shape comes from, and the nodes that read it.">

![The panel of Triage, a language model node, open on Shape: When it runs says on 2 of 3 paths and skipped when its condition is false; Returns lists, from its output schema, items with action, reason, priority and conversationId, and summary, above Show as TypeScript; Read by offers Record, Due and The automation output.](/images/platform/automation-editor-node-shape.webp)

</Frame>

The **Model** picker of an `llm` or `agent` node lists the models your organization’s connected providers serve; a model that is not listed can still be typed, but **Problems** then warns that a live run would fail at that node until its provider is connected. **Change model**, in the header, uses another model in every `llm` node that names one model — the steps it changes are listed first — as one edit you then save.

<Frame caption="Change model on the Gmail inbox triage: the model its two language model steps name, the served model picked to use instead, and the steps that change.">

![The Use another model in all steps dialog. Replace shows anthropic/claude-haiku-4-5 with 2 steps, With shows Claude Sonnet 4.6, and Steps that change lists Triage and Draft, above Cancel and Use this model.](/images/platform/automation-model-swap.webp)

</Frame>

Open **Control flow** for the node's condition, iteration and failure handling; it is already open on a node that uses one of them. **When**, **For each** and **Repeat until** take expressions. **Else of** offers only nodes that have a condition, and **None** removes the alternative. **Maximum repeats** appears with **Repeat until** and takes a whole number from 1 to 20. **On error** chooses between **Stop the run** and **Continue without it**; continuing skips every node that reads the failed node's output. Under a condition, a list or an alternative, a sentence says in words what the setting does.

Use **Close** to return to the canvas. On a wide screen, clicking the empty canvas or pressing Escape outside a text field also closes the panel. The automation's trigger and project settings are on the **General** tab. [Automation concepts](/platform/automations/concepts) explains the node types and expression rules.

### Code, prompts and JSON

Code, prompts, conditions and JSON fields are code editors. They colour the syntax and every `{{ }}` template, and they know the automation. Type `{{` in a prompt and the closing braces appear with the cursor between them; type `nodes.` to see only the nodes that run earlier, and `.output.` to see that node's fields with their types. Ctrl+Space opens the suggestions anywhere. Point at a reference to see its type, or press ⌘K ⌘I (Ctrl+K Ctrl+I) to have the type at the cursor shown and read out.

<Frame caption="After nodes. in a template, the suggestions offer the nodes that run earlier, each with its shape.">

![The Prompt field of Triage in the code editor: its last line is a template with the cursor after nodes., and the suggestion list offers inbox beside the shape it returns, an object with a list of conversations.](/images/platform/automation-editor-code.webp)

</Frame>

A moment after you stop typing, a problem is underlined exactly where it is. F8 and Shift+F8 move to the next and previous problem and read it out; ⌘. (Ctrl+.) applies a suggested fix, such as the closest node name. In a field with several lines, Tab indents; to leave it with the keyboard, press Escape, then Tab. **Expand editor** opens a long field in a larger editor, and **Back to the field** returns to it with your edit and your cursor in place.

A JSON field such as **Input** changes the node only when its text is valid JSON of the right kind. While you type, the node keeps its last valid value and the field says what is missing, such as "This must be a JSON object, in curly braces."

### Start inputs and End output

Select **Start** to see what starts the automation. **Trigger** lists it in words; **Change in General** opens the **General** tab, where you set the trigger. Under **Fields**, **Inputs** shows the fields of the run input as a tree, and **Input schema** holds the JSON Schema behind them, which you can edit. **Shape** shows the input as Tale reads it, and **Last run** the input of the run shown.

<Frame caption="Start’s fields: the trigger in words, the fields of the run input, and the JSON Schema behind them.">

![Start selected on the canvas, with its panel beside it: the trigger Every 6 hours · UTC, switched off, and By hand, the API or MCP, above Change in General; under Fields, Inputs lists limit, firedAt and trigger with their descriptions, and Input schema holds the JSON Schema in a code editor.](/images/platform/automation-editor-start.webp)

</Frame>

Select **End** to see what a run returns. **How a run ends** lists the three outcomes; under **Failed**, each node whose failure stops the run is a button that opens it. Under **Fields**, **Output** holds the JSON value a successful run returns, with templates such as `{{ nodes.report.output }}`. **Shape** shows the output's shape, and **Last run** the output of the run shown.

## Read the source

Choose **Source** in the view switch to read the whole document as YAML, highlighted, with line numbers, folding and search (⌘F or Ctrl+F). Every problem the check found is underlined at the line it concerns, so a problem in a part without a field of its own, such as the name, has a place to be read. The source is read-only: **Copy YAML** copies it, and **Download YAML** saves it as a file named after the automation and version, such as `gmail-triage-inbox-v3.yml`, with `-draft` added while you have unsaved changes. To change the document, use the fields or your coding agent.

<Frame caption="Source: the whole document as highlighted YAML, to copy or download.">

![The Source view of Triage the Gmail inbox: YAML with line numbers and fold markers, from name: gmail-triage-inbox through its inbox and triage nodes, under the line To change the document, use the fields or your coding agent, with Copy YAML, Download YAML and Edit with your coding agent above it.](/images/platform/automation-editor-source.webp)

</Frame>

## Edit with your coding agent

Larger changes, such as adding nodes or reworking the flow, come from a coding agent such as Claude Code, Codex or Cursor, connected to Tale's MCP server. **Edit with your coding agent** is the last button at the top right of the canvas in every view, and the main action of an automation that has no nodes yet. Its dialog shows the automation's name to give the agent, **Set up MCP**, which opens **Settings > API > MCP**, and **How to connect a coding agent**, which opens the [MCP endpoint](/develop/mcp-endpoint) guide. The agent reads the automation, changes and checks it, and saves a new version, which then appears on the canvas as [When a new version arrives](#new-versions) describes.

## Find and fix problems

While you edit, Tale checks the draft the same way it checks a save. A moment after you stop typing, the **Problems** button beside **Tests** shows what the check found: a red error icon and an amber warning icon, each with its count, or **No problems**. On a phone, the button sits in the toolbar over the canvas. An error is something a run would fail on, such as a reference to a node that does not exist. A warning is something that might go wrong, such as reading the output of a node that is sometimes skipped. A node, a condition, Start or End with problems shows the same counts on its box, and a field with a problem explains it under the field.

Click **Problems** to list them. On a wide screen the list opens under the canvas; on narrower screens it opens in a panel. Each entry says what is wrong, where it is, why, and how to fix it. **Technical details** shows the engine's own message, and the code beside the title helps when you search or ask for support. **All**, **Errors** and **Warnings** filter the list, and Escape closes it.

<Frame caption="A reference to a node that doesn’t exist: the field marks it, Save waits, and Problems says why and how to fix it.">

![The editor with one error: the Prompt of Triage ends in a template reading nodes.nope.output, underlined in red, with the reason under the field; the header shows 1 error and Tests beside a disabled Save, and Problems under the canvas, beside the Tests tab, lists Reference to an unknown node at triage › Prompt, its code REF_UNKNOWN_NODE, why the read fails and how to fix it.](/images/platform/automation-editor-problems.webp)

</Frame>

Select an entry, or press Enter on it, to go there: the node opens, its field takes focus, and the part that causes the problem is selected. A problem with no field of its own, such as a model the organization does not serve, is listed under **Problems in this node** at the top of the node's fields. A problem in the inputs opens **Start**, one in the output opens **End**, one in a test opens that test under **Tests** with the place selected in its YAML, and one in any other part of the document, such as the name, opens **Source** at that line. A problem in a node that your draft no longer has says "Change this with your coding agent."

While errors remain, **Save** is disabled and says why, for example "Fix 1 error to save". On a phone, where **Save** sits under a node's fields, **Show problems** beside that reason opens the list. Warnings never block saving or deploying. If Tale can't check the draft, for example because the connection dropped, the button shows **Couldn't check** and you can still save: every save is checked again on the server. When a save or a deploy is refused because of errors, the list opens with the server's problems, starting at the first error.

The check runs only for Developers, Admins and Owners, the roles that can save. [What Tale checks before a run](/platform/automations/concepts#checks) explains each kind of problem.

## Save and test a version

1. Edit the required fields and click **Save**.
2. Enter a **Version message** that explains the change, then **Save version**. This appends a version and preserves earlier ones. The dialog names the version you create, such as **Saves as v6.**, and **Review changes** lists what your draft changes, as [Compare two versions](#compare) shows them. If someone saved another version while you were editing, Tale refuses the save and says which version was saved, by whom and when; **See what changed in v6** opens its changes in a new tab. **Discard my changes and reload** shows the newer version, **Save anyway** appends your version on top of it — the newer one stays in the version history, but the latest version is then yours.
3. Click **Test run**. If the workflow declares an input schema, type the input as JSON in **Run input (JSON)**; the field suggests the schema's field names as you type a key, and ⌘Enter (Ctrl+Enter) starts the run. Expand **Input schema** to see the required fields and their types. Invalid JSON or a schema mismatch prevents the start.
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

To check the same cases on every save and before every deploy, write them as tests: [Test an automation](/platform/automations/testing) shows how.

<Frame caption="For an input-driven workflow, supply JSON and inspect its schema before starting the test.">

![The Test run dialog shows Start from above Run input (JSON), owner and repo JSON values in the code editor, and the expanded input schema as a list of fields.](/images/platform/automation-run-input.webp)

</Frame>

### Try the draft {#try-the-draft}

With unsaved changes, **Test run** first asks **What runs**. **This draft (not saved)** runs your changes once with the same mocks, without saving them: the run is kept nowhere and does not appear under **Runs**. The other choice, such as **Version 3**, runs the saved version on screen, as above. The run input is checked against the input schema of the one you choose.

**Start from**, above **Run input (JSON)**, fills the input from a test, one of the five newest runs, the trigger's input, nothing (**Empty**), or a placeholder for each required field (**Fill the required fields**). The dialog opens on your last choice for the automation. When the test you start from simulates steps, **Use the test's simulated outputs and failures** appears, on by default: the try then stands in for those steps as the test does, and they carry **Simulated output** or **Simulated failure** on the canvas. A saved version's run doesn't use them.

<Frame caption="Start from in the Test run dialog of a draft: the tests and runs to take the input from, nothing, or the required fields.">

![The Test run dialog of Order discounts with This draft (not saved) chosen under What runs and the Start from menu open: under Tests, Small order pays full price, Big order gets 10% off and New test; under Runs, a run that succeeded; under Other, Empty and Fill the required fields.](/images/platform/automation-run-start-from.webp)

</Frame>

The draft's run then lies over the canvas in place of the last run, under an **Unsaved test** strip that says how it ended and when, such as **Succeeded in 12 ms** or **Failed at Score**, and it plays back step by step like a recorded run. Select a node to see what it received and returned on its **Unsaved test** tab. Once you change the draft, the strip says **The draft changed since this try.** **Try again** runs the draft as it is now, with the same input; ⌘⇧Enter (Ctrl+Shift+Enter) does the same while the canvas or the inspector has focus. **Hide result** brings back the last run. A try stops after 20 seconds.

<Frame caption="A try of the draft on the order discounts: the strip says how it ended, and Review, which only an order of a thousand or more reaches, shows what it got on its Unsaved test tab.">

![The editor of Order discounts with an Unsaved test strip above the canvas reading Succeeded in 13 ms, with Try again and a button to hide the result. On the canvas, Discount, Total and Review succeeded, Review's condition, quantity of the run input is at least 1,000, reads Yes, and the playback bar rests at the run's end. Beside the canvas, Review's Unsaved test tab shows the resolved input total 22800 and the output note Wholesale order of 22800: sales confirms the price.](/images/platform/automation-try-draft.webp)

</Frame>

### Test one node, or up to a node {#step-tests}

To try one step without the rest, select its node and open **Test node** beside its name:

- **Test this node** runs the node alone, as the draft has it, on the data you give it. Under **Uses data from**, each node it reads gets its output as JSON: from the run on the canvas when there is one, as you last tested the node, or empty for you to write. **Run input (JSON)** appears when the node reads the run's input, and **Item** when it runs once per item. On the canvas the nodes it reads carry **Pinned data** and the rest **Left out of this test**; the node's **Node test** tab shows what it received and returned. When its condition is false with that data, the strip says the test ran it anyway.
- **Test up to here** runs the draft up to the node: everything it needs, and nothing after it. It asks for the run input as **Test run** does, and the strip reads **Up to Review**.

Agent nodes are simulated in tests. Like a try, a step test keeps no run; the data you give a node is kept for the session, so testing it again starts from it.

<Frame caption="Total tested alone: Discount pinned to a 20 % rate, the rest of the draft left out, and what Total received and returned.">

![The editor of Order discounts with a Node test: Total strip reading Succeeded in 3 ms. On the canvas, Discount carries Pinned data and succeeded, Total succeeded, and Review and End are dashed and Left out of this test. Beside the canvas, Total's Node test tab shows the resolved input rate 0.2, quantity 1000 and unitPrice 2, and the output gross 2000, discount 400 and total 1600.](/images/platform/automation-step-test.webp)

</Frame>

### Start from an older version {#older-version}

When **Version** shows an older version than the latest, a band above the canvas says so, such as **You're viewing v2. The latest is v5.** **Show v5** switches to the latest version, and **Compare v2 with v5** shows what changed since.

You can still edit the older version. The band then adds **Saving creates v6 from v2.**, and saving does exactly that without asking you to reload. The save dialog says **Saves as v6, based on v2.** and warns that the changes made in v3 to v5 are not in your draft, with a link to compare them. In the version history, the new version carries **Based on v2**. To keep those changes, switch to the latest version before you edit.

<Frame caption="Saving an edit of v2 while v4 is the latest: the dialog says what the save creates and which changes the draft leaves out.">

![The Save a new version dialog says Saves as v5, based on v2, warns that changes made in v3 to v4 are not in this draft with a Compare v2 with v4 link, and under Review changes shows Post changed, its code compared line by line.](/images/platform/automation-version-save-review.webp)

</Frame>

## Deploy and run live

Choose the tested version under **Version** and click the deploy button beside it, which names that version, such as **Deploy v3**; for a version older than the live one, it reads **Roll back to v2**. The **Live** badge marks the deployed version. The deploy works as on **Versions**: a notice confirms it and offers **Undo**, and if another version went live in the meantime, nothing changes and the notice says who deployed it. You can also deploy any saved version from **Versions**, as [Deploy or roll back in one click](#deploy-in-one-click) describes.

A version whose saved tests failed cannot be deployed; correct the cause and save a new version. If the version no longer passes today's checks, the deploy is refused and **Problems** lists what to fix; with unsaved changes on screen, discard them first to see that list.

**Run live** starts the deployed version, even if you are viewing another one. Its confirmation shows the scope and, when required, **Run input (JSON)** for that deployed version. Check both before confirming. Live runs may act on connected systems and may wait for an [approval](/platform/approvals/concepts).

A trigger also runs the deployed version. Set it up only when you are ready for repeated or externally initiated execution; see [Automation triggers](/platform/automations/triggers).

## Versions and deployments {#versions}

**Versions** shows what runs live and how the automation got there. Its top card names the live version, when it went live, who deployed it and how, such as **in the app** or **with Claude Code through MCP**, and how many of its runs are still in progress. Those runs finish on the version they started with, whatever goes live next. **Compare v1 with v2** shows what the live version changed against the one it replaced. When no version is live yet, the card offers to deploy the latest one.

<Frame caption="The Versions tab: the live version on top, then every saved version with its message, author, changes and tests.">

![The Versions tab of Weekly digest: a card says v3 is live, since when and by whom, with Compare v2 with v3 and Roll back to v2; below it the Versions table lists v4 to v1 with their messages, You in the app, the date, changes such as 1 changed and 1 renamed, and No result under Tests.](/images/platform/automation-versions.webp)

</Frame>

The **Versions** list below the card shows every saved version, newest first:

- **Version** carries the **Live** badge on the deployed version and says when another version last went live.
- **Message** shows the version message. **Restores v3** marks a restored version, and **Based on v1** marks a version saved from an older version than the one before it.
- **Saved by** names who saved the version and how. Versions the platform installed show **Tale**.
- **Changes** counts the nodes the version added, removed and changed compared with the version before it, and names other parts that changed, such as **Output** or **Tests**. **First version** marks the first one; versions saved before Tale kept this summary show **Not recorded**.
- **Tests** says whether the version’s tests **Passed** or **Failed** when it was saved. **No result** means no verdict was kept, for example because the version has no tests.

Select a row to see what that version changed, as [Compare two versions](#compare) describes. Its menu also offers **Compare with live**, **Open in editor** and **Download YAML**, which saves the version as a file named after the automation and version, such as `weekly-digest-v3.yml`.

Choose **Deployments** above the list to see every time a version went live: when, which version, whether it was a rollback, which version it replaced and who deployed it. A version that was live before Tale kept this history reads **v4 was live** and is marked **Recorded before the history started.** Select a row to see what that deploy changed against the version it replaced.

The automation list leads here as well: select a row’s version count, or choose **Version history** in its row menu.

### Deploy or roll back in one click {#deploy-in-one-click}

You need Developer, Admin or Owner permissions. On the top card, **Roll back to v1** puts back the version the live one replaced; after a rollback, the same place offers the newer version again, such as **Deploy v3**. In either list, open a row’s menu and choose **Deploy v5** or **Roll back to v3**.

The version goes live at once: triggers and new live runs use it, and runs already started keep theirs. A notice confirms it, such as **v3 is live.**, with **Undo**, which puts the replaced version back the same way. If the automation’s trigger is off, the page says so and offers **Turn on the trigger**.

Tale compares the live version on your screen with the one live when you click. If someone else deployed a version in the meantime, nothing changes: the notice names who deployed which version and when, and **Show deployments** opens the list so you can decide again. A version that no longer passes today’s checks, or whose tests failed, cannot go live. A dialog lists what to fix, and **Open v4 in the editor** takes you there.

### Restore an older version {#restore}

To bring an older version back as the newest, choose **Restore as new version** in its row menu. Tale saves a copy of it on top of the latest version, and the versions in between stay in the history. The **Version message** starts as **Restore v3**; you can change it. The live version stays as it is unless you also tick **Make v5 live right away**.

After **Restore**, a notice confirms the new version, and **Open v5** shows it in the editor. If the latest version already matches the one you restore, nothing is saved. If someone saves a version while the dialog is open, the dialog says who and offers to restore on top of that version instead.

### Compare two versions {#compare}

A version's page shows what it changed. Its header names the version, its message, who saved it and how, and offers **Open in editor**, the version's deploy or rollback button, and in its menu **Restore as new version** and **Download YAML**. **Compare with** chooses the version to compare it with; the version before it, the live version and the version it was based on come first. The chips beside it count the nodes added, removed, changed and renamed, and name the other parts that changed, such as **Inputs** or **Tests**.

Choose how to read the changes:

- **Graph** draws both versions on one chart. An added box has a green frame and **Added**, a removed one is red and struck through, a changed one is amber with what changed at its foot, and a renamed one says its old name, such as **Was Post**. A line only one version draws carries a plus or a minus. The switch above the chart shows either version's own chart with the changes brought forward. Select a box to see its changes beside the chart: Start shows the inputs that changed, End the output.
- **Changes** lists every change by where it is: **Start: run inputs**, **Nodes**, **End: output**, **Tests** and **Package data**. Open a row to see its fields before and after; code, prompts and conditions are compared line by line. **Show on the graph** selects the box a change belongs to.
- **YAML** compares the two versions' source line by line, unified or side by side.

<Frame caption="v4 compared with v3 on Graph: Post renamed Publish and Summarize's code changed, with the renamed step's changes beside the chart.">

![The comparison of v4 with v3 of Weekly digest: chips read 1 changed and 1 renamed; the chart marks Summarize as Changed with Code changed and Publish as Renamed with Was Post, and the Changes of the node panel lists Publish as Renamed, Was Post.](/images/platform/automation-version-compare.webp)

</Frame>

On a phone, the page opens on **Changes**. Two versions with the same content say **No differences between v3 and v5**, and the page adds when only their messages differ. The first version is compared with nothing: everything in it is new. Triggers and projects belong to the automation, not to a version, so a comparison never shows them.

## Diagnose a result

Once the automation has run, the canvas shows its latest run: each node's bottom line says how it ended, such as **Succeeded** or **Skipped**, and each condition shows how it decided, **Yes** or **No**. The eye button at the top right of the canvas, **Hide last run**, removes the run from the canvas, and **Show last run** brings it back. Select a node and open **Last run** to see its **Resolved input**, **Output**, and effects. This is often enough to find a wrong reference: compare the input received by the failed node with the output of the node it reads.

Switch to **Runs** and open a row for the full record. The tabs remain visible with **Runs** active; **Editor** returns to the workflow. Check whether it was a test or live run and inspect already completed operations before starting another run. [Execution logs](/platform/automations/execution-logs) explains waiting, failures, automatic retries, and stopping.

## Roll back or delete

To roll back, open **Versions** and use the top card or a version’s row menu, as [Deploy or roll back in one click](#deploy-in-one-click) describes. You can also open an earlier version in **Editor** with **Version** and click its button there, such as **Roll back to v2**. Future starts use it; version history remains intact. A version message such as “Restore the previous recipient mapping” makes that choice easier to review.

To delete the automation, return to the list, open its row menu, and select **Delete**. Read the named confirmation. All versions, deployment, trigger, and project bindings are removed. An unfinished run blocks deletion; stop it or let it finish first. Past runs remain subject to retention. Deleting an automation does not undo the actions its runs already performed.
