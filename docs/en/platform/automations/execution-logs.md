---
title: Read automation runs and recover from failures
description: See why a run failed or a step was skipped, what each step read and returned, play the run back, and run it again, from a step, or side by side with another run.
---

Open an automation, switch to its **Runs** tab and select a row to understand what happened. Start with its status, version and mode, then inspect the relevant node. A successful test run proves the workflow’s mocked execution; it does not prove that a real external account will accept the same action.

<Frame caption="A finished test run: its status, mode, version, starter, and times above the workflow, with each node's result.">

![The run page of a test run of Triage GitHub issues, marked Succeeded, Test, and v1 and started by you, with its start and finish times above the workflow graph, where the issues, open issues, score, and report nodes each show Succeeded; the run's effects list begins below the graph.](/images/platform/automation-run-detail.webp)

</Frame>

## Read the run’s state

The **Runs** tab lists the runs you can see, newest first, and loads older ones as you scroll; **Filter** narrows them by status and mode. Owners, Admins, and Developers see the organization’s own runs; a run in a project, and any question it waits on, appears only to those of them who can open that project. Each row identifies its version, time, mode and starter, or says why the run failed or what it waits for. The detail shows the workflow with node results and run timing; an unfinished run has no completion time. The tabs stay visible while you inspect a run. Choose **Runs** to return to the list or **Editor** to change the workflow.

| Status | Meaning | What to do |
| --- | --- | --- |
| **Queued** | Accepted, waiting for execution. | Wait and inspect capacity if it does not progress. |
| **Running** | The engine is processing the workflow. | Follow node progress. |
| **Interrupted — resuming** | The server running it stopped; another one takes it over within about a minute and a half. | Wait; nothing to do. |
| **Waiting** | A decision, reply, agent turn or polling condition is outstanding. | Read what it is waiting for. |
| **On hold** | Earlier work started before the upgrade has an unknown outcome. | Inspect the hold details; do not assume it is safe to replay. |
| **Succeeded** | Reached nodes completed and the workflow produced its output. | Review output and effects. |
| **Failed** | Execution ended with an unhandled failure. | Open the failed node and read its error. |
| **Stopped** | The run was cancelled. | Inspect work already performed before restarting. |

A waiting approval, a question or a step that may already have run requires a person; a running agent or polling node may continue without you. A decision or answer can also be refused or expire. Use the displayed reason, not **Waiting** alone, to decide whether action is needed. [Approvals in workflows](/platform/automations/approvals-in-workflows) explains the decision controls.

## A run held after an upgrade

**On hold** means Tale cannot verify the outcome of work started before the upgrade. The run does not automatically resume or replay, and its task remains reserved. Its recorded checkpoints and effects remain available; missing effects do not prove that an external service received nothing.

Leave the run on hold while you investigate. **Request stop** asks Tale to stop the sessions it can identify and explains the uncertainty before you confirm. **Stop requested** is not confirmation that the work stopped: the hold remains until its earlier work is confirmed to have stopped. The request does not undo earlier external actions. If the hold changes while the confirmation is open, close the dialog and review the updated details.

## Understand why a run failed {#failures}

A failed run opens with a card that says where it failed and why: **The run failed at Greet**, a short title for what went wrong, such as **A value it reads is missing**, what that means, the concrete cause, and **How to fix**. For a missing value, the cause names the expression, the field it read, and the step whose output held nothing; the fix suggests a read that cannot fail, such as `nodes.fetch_customer.output.customer?.email`. The engine’s own message stays under **Technical details**.

Below the card, the step and its field, such as **Greet › input.email**, sit beside **Show in editor**, which opens the editor on the version the run ran with that step selected. **Show step** selects the step on the run’s canvas, and **Retry from this step** prepares the retry described in [Retry from a step](#retry-from-step).

On the canvas, the failed node is framed in red and its bottom line repeats the failure’s title; the nodes the run went through to reach it stand out while the others step back; and End says where the run failed, such as **Failed at Propose**. The **Runs** list names a failed run’s cause with the same title.

Applications reading the [run API](/develop/api-reference) also receive `failureCode` when a failed run has a classified cause. For example, `approval_rejected` means a person refused the operation, while `llm_output_invalid` means a model response did not match the required structure. Historical failures can lack a code. Use it to route an investigation; it does not establish that retrying is safe or will succeed.

## Find out why a step ran or was skipped {#conditions}

Select a node on the run’s canvas to open its **Last run** tab. A step that ran or was skipped because of a condition says so in a sentence, such as **Big order was skipped because its condition was false**. Below it, **Only if** shows the condition in words, with the value each reference read and the way it came out: “amount of the run input (250) is not greater than 1,000”, **No**. A condition joined with `&&` or `||` lists each part with **Yes** or **No**; a part the run never had to check reads **Not checked**. A condition written as code shows its code instead.

A skipped node may have a false condition, an alternative that ran, a skipped step it reads, or a failure rule that let the run continue; the sentence names which, and the step involved. Do not assume every skipped node is an error.

On the canvas, each node’s bottom line says how it ended: **Succeeded**, **Failed**, **Skipped**, **Not run**, **Not reached yet**, **Reused** for a step a retry took over from an earlier run, or, on a stopped run, **Stopped here** for the node the run was on when it was stopped. Each condition shows how it decided, **Yes** or **No**.

## See what a step read, received and returned {#step-data}

**What was read** lists each value the step took from the run input or from other steps, in words and with the value it read, such as “items of Inbox: 3 items”. **Received** shows the step’s input after its templates were filled in, and **Returned** what it produced. Together they tell a bad reference from a service failure. A value that held a secret is hidden and says so, and a value too large to keep in full says that only part of it was kept.

A value reads as a tree you open with the arrow keys. **Values** and **Shape** switch between the values and the fields and kinds they hold, and the buttons copy a value, download a large one or open it full screen. When a step’s input and output are both objects or both lists, **What it changed** lists the fields the step added, removed and changed.

A step that runs once per item lists its items, each with how it ended and, for a failed one, why. **Failed only** narrows the list, and selecting an item shows what that item read, received and returned. Tale keeps the first 200 items and every failed one. A step that needed more than one try, or whose try a restart cut short, lists its **Attempts**. A step that called a service says whether the call was done, failed or may already have run, and what a person chose about it.

For example, a reminder node may receive a customer name but an empty invoice ID. Inspect what it read from the step before it: if the record now uses another field, correct the reference there rather than replacing the mail credential. Verify the corrected input in a new test run.

## Play the run {#play}

The bar under the run’s canvas plays the run back: each step lights up while it works, values travel along the lines to the steps that read them, and each condition shows its decision. It opens on the run’s end, so you see the whole story first. **Play** runs it from the start, **Previous event** and **Next event** step through it, and the slider moves to any moment; the clock shows how long the run had really been going, and the speed changes how fast it plays. Long waits are shortened so they do not stall the replay. While a run is still going, the bar follows it; after you move back, **Follow live** returns to its end.

**Steps**, beside **Chart**, lists the same run as its steps in time order: how long each worked, a bar for when it worked, each condition with its decision, and waits and restarts. It plays on the same clock. Choosing a step opens it and moves the clock to where it started, and **Chart** shows the canvas at that moment. A step that ran once per item or repeated opens to its items or passes, each with how it ended and how long it worked, and choosing one opens it in the step’s **Last run** tab. The page’s address keeps the view (`?view=steps`), the step and the item you chose, so a link or a reload opens the run where you left it.

## Run it again {#run-again}

**Run again** starts a new run of the same version with the same input and mode. A test run starts at once; a live run that sent writes asks first and names the services it would send to again. The menu beside it offers:

- **Edit input and run…** opens the run dialog with this run’s input to change; confirming an unchanged input runs the run again.
- **Run again on v6 as a test** when a newer version exists, and **Run again as a test** for a live run.
- **Run live on v5** when another version is live and your role may start live runs.
- **Compare with the previous run**, **Copy run ID** and **Copy link**.

When a live run cannot run again live, because its version is no longer live or your role may not start live runs, **Run again** says why.

The new run’s header names where it came from, such as **Replay of run 1db433 · edited input**, with **Open run** and **Compare with it**. A replay is a new run: it sends its writes again, and it uses what a run uses.

## Retry from a step {#retry-from-step}

**Retry from this step** shows what the retry will do before it starts. **Reused** lists the steps whose results the new run takes from this one, and **Runs again** the step you chose and every step after it that depends on it. When those steps write to a service and the retry runs live, the dialog warns that the writes go out again. A retry of a test run stays a test, because the results it would reuse were made up.

Tale refuses a retry it cannot do faithfully and says why: the version to run changed a step the retry would reuse, the run has not finished, or the run kept no input. On the new run’s canvas, the steps it took over are marked **Reused**.

## Compare two runs {#compare}

**Compare with it** on a replay, **Compare with the previous run** in the **Run again** menu, or two runs selected in the **Runs** tab and **Compare** opens two runs side by side. **What differs** names, most telling first, the versions they ran, how many fields of their input differ, the step where they split and why, such as a condition that went the other way, how each ended, and their output and writes. The table below lists each step with how each run left it and whether its data is the same. **Swap A and B** swaps the two runs. When their input or output differs, **Input: A → B** and **Output: A → B** show the two side by side, each changed field marked. **Both runs on the chart** draws the two on the chart of B’s version: each step says how A and how B left it, the step where they part is ringed, and a step A’s version lacks is dashed.

## Check what the run changed

The effects list records connector writes, with the node, connector and input. A test uses deterministic stand-ins; live actions can change external systems. The run explicitly reports when it has no recorded effects.

Read effects before retrying. A failure later in the graph does not undo an earlier message or update. For delivery-sensitive work, confirm the result with the receiving service as well. Effects are retained with the run until deletion or retention removes that record; they are not a permanent independent archive. Deleting the automation keeps its runs: a run page still opens, marked with the deletion date and drawn from the run’s own trace, until retention removes it.

## Understand continuation and automatic retries

The engine checkpoints completed nodes and resumes after those checkpoints when execution continues. A separate run, such as one started with **Run again**, starts with separate checkpoints and can repeat writes, so it is different from resuming the existing run; a [retry from a step](#retry-from-step) reuses only the results of the steps before that step.

A run can move to another server while it runs. A server that is being updated or restarted hands its runs on at their next step: the step under way finishes, and the next server continues with the step after it, or with the next item when the step runs once per item. A step still working 20 seconds into the restart is interrupted and runs again on the next server. When a server stops without warning, another one takes its runs over within about a minute and a half. Steps that had finished do not run again. The run’s header then reads **Resumed after a restart**, or how many restarts, with the time of the last move and its reason: the server running it was being updated or restarted, or it stopped responding. Until another server has taken the run over, its status reads **Interrupted — resuming**.

A step that was sending something to an outside service when its server stopped is the exception: Tale cannot tell whether the service received it, so it does not send it again on its own. The run waits instead, and its page names the step, the connector, the item when the step runs once per item, and what the step was sending. Check the service, then choose how to continue:

- **Run it again** sends it once more. If the service had already received it, it happens twice, so Tale asks you to confirm first.
- **Skip it** continues the run as if the step returned nothing. Choose it when the service already received what was sent.
- **Fail the run** stops the run there and records it as failed with the `effect_in_doubt` code. Nothing the run already did is undone, so Tale asks you to confirm first.

Anyone who can stop the run can make this choice. The run waits until someone does; no notification is sent, and the run list shows the step it is waiting on.

An eligible agent-step failure can receive up to three automatic retries after the original attempt. Upstream checkpoints remain intact, and the header reports **Auto-retry 1 of 3** and subsequent attempts. An attempt that performs at least fifteen minutes of execution refreshes that retry budget. Subscription pools can choose another account for a new attempt. When a subscription broker refreshed the account while the step worked and the provider rejected the old token, the retry continues on a fresh token without using one of the three retries; a third such interruption in a row counts like any other failure. When the step could not start because every account of the pool was cooling down after a rate limit, the retry starts once the first account is available again, at most a minute later, and continues the conversation the refused attempt was to resume. That wait uses one of the three retries unless the refused attempt was itself retrying a rate-limit failure. When the failed turn had announced its conversation handle, the retry resumes that conversation over the preserved workspace — the agent continues where the cut landed instead of reasoning from the start; a turn that died before announcing one, or whose sandbox session is gone, starts fresh. A Gemini CLI step always starts fresh, because that runtime cannot resume a conversation in which it ran a tool; [Choose an agent runtime](/platform/agents/harnesses) explains the exception.

An agent step also fails when its model returns nothing at all: no text, no tool call and no generated tokens. A model server can answer this way when it breaks down mid-answer. The run then reports “The model returned an empty answer, so the agent did nothing this turn.” This failure receives those retries too. A step whose model only used tools, or reported generated tokens but no visible text (reasoning, for example), has answered and does not fail this way.

An exhausted budget, full execution-window timeout, or expired question does not receive those retries. Each attempt consumes its own resources; retrying does not erase earlier charges. If repeated attempts cannot fix the cause, stop the run and correct the dependency before starting another.

## Stop or repair the workflow

Select **Stop the run** for an unfinished run you want to cancel, and confirm. Cancellation stops further work at the engine’s execution boundaries; it does not roll back completed effects. If the run finishes before the cancellation reaches it, its completed outcome is retained.

To repair a document problem, use **Show in editor** on the failure card or return to the editor, change the relevant input or node, and save a version with a useful message. Run a test with representative input and inspect the values and output, not only the success badge. Deploy that version when the result is ready. Scheduled and webhook starts then use the deployed version; an older failed run remains a record of the old version.

If the run never started, inspect its [trigger](/platform/automations/triggers). A disabled trigger, missing deployment or rejected input can explain the absence of a run altogether.
