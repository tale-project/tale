---
title: Read automation runs and recover from failures
description: Trace a run from its status to the failing node, inspect recorded writes and decide whether to stop, fix or retry.
---

Open an automation, switch to its **Runs** tab and select a row to understand what happened. Start with its status, version and mode, then inspect the relevant node. A successful test run proves the workflow’s mocked execution; it does not prove that a real external account will accept the same action.

## Read the run’s state

The **Runs** tab lists the latest 50 runs, newest first. Each row identifies its version, time, mode and starter, or gives a failure or waiting reason. The detail shows the workflow with node results and run timing; an unfinished run has no completion time. The tabs stay visible while you inspect a run. Choose **Runs** to return to the list or **Editor** to change the workflow.

| Status | Meaning | What to do |
| --- | --- | --- |
| **Queued** | Accepted, waiting for execution. | Wait and inspect capacity if it does not progress. |
| **Running** | The engine is processing the workflow. | Follow node progress. |
| **Waiting** | A decision, reply, agent turn or polling condition is outstanding. | Read what it is waiting for. |
| **Succeeded** | Reached nodes completed and the workflow produced its output. | Review output and effects. |
| **Failed** | Execution ended with an unhandled failure. | Open the failed node and read its error. |
| **Stopped** | The run was cancelled. | Inspect work already performed before restarting. |

A waiting approval or question requires a person; a running agent or polling node may continue without you. A decision or answer can also be refused or expire. Use the displayed reason, not **Waiting** alone, to decide whether action is needed. [Approvals in workflows](/platform/automations/approvals-in-workflows) explains the decision controls.

## Inspect the node that matters

Select a node on the run’s canvas. **Resolved input** shows the actual values after template evaluation; **Output** shows what the step returned. These fields distinguish a bad reference from a service failure.

Node states include **Ran**, **Skipped**, **Failed**, **Never reached** and **Not reached yet**. A skipped node may have a false condition, an unmet dependency, an alternate branch or a failure rule that permits continuation. Do not assume every skipped node is an error.

For example, a reminder node may receive a customer name but an empty invoice ID. Inspect its upstream output: if the record now uses another field, correct the reference there rather than replacing the mail credential. Verify the corrected resolved input in a new test run.

Applications reading the [run API](/develop/api-reference) also receive `failureCode` when a failed run has a classified cause. For example, `approval_rejected` means a person refused the operation, while `llm_output_invalid` means a model response did not match the required structure. Historical failures can lack a code. Use it to route an investigation; it does not establish that retrying is safe or will succeed.

## Check what the run changed

The effects list records connector writes, with the node, connector and input. A test uses deterministic stand-ins; live actions can change external systems. The run explicitly reports when it has no recorded effects.

Read effects before retrying. A failure later in the graph does not undo an earlier message or update. For delivery-sensitive work, confirm the result with the receiving service as well. Effects are retained with the run until deletion or retention removes that record; they are not a permanent independent archive.

## Understand continuation and automatic retries

The engine checkpoints completed nodes and resumes after those checkpoints when execution continues. An unfinished run whose continuation was lost can be picked up after a grace period. A separate run starts with separate checkpoints and can repeat writes, so “run again” is different from resuming the existing run.

An eligible agent-step failure can receive up to three automatic retries after the original attempt. Upstream checkpoints remain intact, and the header reports **Auto-retry 1 of 3** and subsequent attempts. An attempt that performs at least fifteen minutes of execution refreshes that retry budget. Subscription pools can choose another account for a new attempt.

An exhausted budget, full execution-window timeout, or expired question does not receive those retries. Each attempt consumes its own resources; retrying does not erase earlier charges. If repeated attempts cannot fix the cause, stop the run and correct the dependency before starting another.

## Stop or repair the workflow

Select **Stop the run** for an unfinished run you want to cancel. Cancellation stops further work at the engine’s execution boundaries; it does not roll back completed effects. If the run finishes before the cancellation reaches it, its completed outcome is retained.

To repair a document problem, return to the editor, change the relevant input or node, and save a version with a useful message. Run a test with representative input and inspect the values and output, not only the success badge. Deploy that version when the result is ready. Scheduled and webhook starts then use the deployed version; an older failed run remains a record of the old version.

If the run never started, inspect its [trigger](/platform/automations/triggers). A disabled trigger, missing deployment or rejected input can explain the absence of a run altogether.
