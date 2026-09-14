---
title: Build a workflow with an approval
description: Import a small workflow, test its proposed email, then inspect and reject the live approval without sending it.
---

This exercise creates a two-step workflow: prepare a message, then request permission to send it. You will inspect the exact recipient and text on a waiting run and reject the operation. That gives you a complete approval example without needing to deliver a real message.

## Before you begin

Use a Developer, Admin, or Owner account. Confirm that your organization's approval policy requires approval for `imap-smtp.send`; the default policy does. A custom policy can change that behavior, so check [Configure approvals](/platform/approvals/configure) before starting the live part.

The mock test needs no mailbox credential. A real approved send would need a configured IMAP / SMTP connector and a recipient you intend to contact. This exercise ends with **Reject**.

## Import the example

Save the following as `workflow.yml`. The `draft` node returns fixed text so the result is easy to verify. The `send` node reads it; those references create the connection on the canvas.

```yaml
version: 1
name: docs/approval-check
description: Practice reviewing an outgoing message before it is sent.
nodes:
  - id: draft
    type: transform
    code: |
      return {
        subject: "Approval practice",
        text: "This is a test message for the approval walkthrough."
      };
  - id: send
    type: imap-smtp.send
    input:
      to: reviewer@example.com
      subject: '{{ nodes.draft.output.subject }}'
      text: '{{ nodes.draft.output.text }}'
output:
  messageId: '{{ nodes.send.output.messageId }}'
tests:
  - name: prepares the outgoing message
    input: {}
    expect:
      effects:
        - connector: imap-smtp.send
```

1. Open **Automations > Create automation > Upload package**.
2. Choose `workflow.yml` and leave **Install into** set to **Organization**.
3. Click **Upload package**. Tale validates the document and saves `docs/approval-check` as a draft.
4. Choose **Later** in the deployment prompt, then open **Approval check** from the list. It opens on **Editor**.

If that name already exists, uploading adds another version. Use a different workflow `name` if you want a separate exercise.

<Frame caption="Upload package accepts the workflow file and lets you choose its organization or project scope.">

![The Upload package dialog shows a file picker and the Install into selector set to Organization.](/images/platform/automations-upload-dialog.webp)

</Frame>

## Test the data flow

On **Editor**, click **Test run**. This example has no runtime input, so it can run with an empty object. Switch to **Runs**. The list should show a **Succeeded** test run.

Open the run and check that the canvas shows both nodes as **Ran**. Select `send` and inspect its resolved input. The recipient should be `reviewer@example.com`, the subject `Approval practice`, and the text the sentence from `draft`. The connector uses a deterministic mock in this mode. No email is sent and no approval card appears.

The workflow includes a test expecting the `imap-smtp.send` effect. A passing mock confirms the graph and proposed call; it does not prove mailbox credentials or message delivery.

## Start the live approval check

Return to **Editor** and click **Deploy this version** to make the tested version live. Leave the trigger unconfigured; this exercise starts once by hand.

Choose **Run live**, read the confirmation and organization scope, then confirm. Switch to **Runs** and open the new **Waiting** run. Its approval card should show **Waiting for your approval**, `imap-smtp.send`, the `send` node, and **The step would call with** containing the same recipient, subject, and text you checked in the mock.

If the run does not wait, inspect its status and policy before continuing. A failed connector call is not proof that an approval was requested.

## Reject and inspect the outcome

Click **Reject** on the card. The operation is refused and the run ends as **Failed**. This is the expected result of this exercise: the workflow reached its human decision, and the outgoing message was not sent.

You cannot edit a pending call's parameters on the card. If a real proposed message is wrong, reject it, correct the definition or input, and start a new run. Approval of a later correct call authorizes that actual operation; it is not just an acknowledgment that you read the card.

For an agent that needs an answer instead of permission, use its `ask_human` capability. That is a different wait, explained in [Approvals in workflows](/platform/automations/approvals-in-workflows). [Execution logs](/platform/automations/execution-logs) helps distinguish these waits from an agent still working.
