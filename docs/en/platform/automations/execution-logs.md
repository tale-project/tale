---
title: Read automation runs and recover from failures
description: Trace a run from its status to the failing node, inspect recorded writes and decide whether to stop, fix or retry.
---

Open an automation, switch to its **Runs** tab and select a row to understand what happened. Start with its status, version and mode, then inspect the relevant node. A successful test run proves the workflow’s mocked execution; it does not prove that a real external account will accept the same action.

<Frame caption="A finished test run: its status, mode, version, starter, and times above the workflow, with each node's result.">

![The run page of a test run of Triage GitHub issues, marked Succeeded, Test, and v1 and started by you, with its start and finish times above the workflow graph, where the issues, open issues, score, and report nodes each show Succeeded; the run's effects list begins below the graph.](/images/platform/automation-run-detail.webp)

</Frame>

## Read the run’s state

The **Runs** tab lists the latest 50 runs you can see, newest first. Owners, Admins, and Developers see the organization’s own runs; a run in a project, and any question it waits on, appears only to those of them who can open that project. Each row identifies its version, time, mode and starter, or gives a failure or waiting reason. The detail shows the workflow with node results and run timing; an unfinished run has no completion time. The tabs stay visible while you inspect a run. Choose **Runs** to return to the list or **Editor** to change the workflow.

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

## Inspect the node that matters

A failed run opens with the node that failed in view. The node is framed in red and its bottom line shows the first line of its error; the nodes the run went through to reach it stand out while the others step back; and End says where the run failed, such as **Failed at Propose**.

Select a node on the run’s canvas to open its **Last run** tab. **Resolved input** shows the actual values after template evaluation; **Output** shows what the step returned. These fields distinguish a bad reference from a service failure.

On the canvas, each node's bottom line says how it ended: **Succeeded**, **Failed**, **Skipped**, **Not run**, **Not reached yet** or, on a stopped run, **Stopped here** for the node the run was on when it was stopped. Each condition shows how it decided, **Yes** or **No**. The badge on the **Last run** tab names the same states **Ran**, **Failed**, **Skipped**, **Never reached**, **Not reached yet** and **Stopped here**. A skipped node may have a false condition, an unmet dependency, an alternate branch or a failure rule that permits continuation. Do not assume every skipped node is an error.

For example, a reminder node may receive a customer name but an empty invoice ID. Inspect its upstream output: if the record now uses another field, correct the reference there rather than replacing the mail credential. Verify the corrected resolved input in a new test run.

Applications reading the [run API](/develop/api-reference) also receive `failureCode` when a failed run has a classified cause. For example, `approval_rejected` means a person refused the operation, while `llm_output_invalid` means a model response did not match the required structure. Historical failures can lack a code. Use it to route an investigation; it does not establish that retrying is safe or will succeed.

## Check what the run changed

The effects list records connector writes, with the node, connector and input. A test uses deterministic stand-ins; live actions can change external systems. The run explicitly reports when it has no recorded effects.

Read effects before retrying. A failure later in the graph does not undo an earlier message or update. For delivery-sensitive work, confirm the result with the receiving service as well. Effects are retained with the run until deletion or retention removes that record; they are not a permanent independent archive. Deleting the automation keeps its runs: a run page still opens, marked with the deletion date and drawn from the run’s own trace, until retention removes it.

## Understand continuation and automatic retries

The engine checkpoints completed nodes and resumes after those checkpoints when execution continues. A separate run starts with separate checkpoints and can repeat writes, so “run again” is different from resuming the existing run.

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

To repair a document problem, return to the editor, change the relevant input or node, and save a version with a useful message. Run a test with representative input and inspect the values and output, not only the success badge. Deploy that version when the result is ready. Scheduled and webhook starts then use the deployed version; an older failed run remains a record of the old version.

If the run never started, inspect its [trigger](/platform/automations/triggers). A disabled trigger, missing deployment or rejected input can explain the absence of a run altogether.
