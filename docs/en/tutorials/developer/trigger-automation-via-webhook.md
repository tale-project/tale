---
title: Trigger an automation via webhook
description: Install a deployed automation in a project, bind a webhook, send a delivery and verify the completed run.
---
Connect an external event to a deployed automation and verify both acceptance and the finished run. This tutorial uses a project-scoped webhook, an API key for setup and polling, and curl for delivery. The external sender needs only the webhook URL.

## Prepare a harmless test automation

Choose a deployed automation whose tests pass and whose first run cannot send messages, change customer data or trigger other external effects. A transform that returns its input is enough to verify delivery. Create and deploy it through the app or [MCP](/develop/mcp-endpoint); REST does not create or deploy automation definitions.

Use an active project where you have edit access and a Developer-capable API key. Set `TALE_BASE_URL`, `TALE_API_KEY`, `TALE_ORG_SLUG`, `TALE_PROJECT_ID` and `TALE_AUTOMATION`. The organization value is a slug; the project value is an ID. In automation URLs, replace `/` within a name with `__`.

## Install the automation in the project

A webhook delivery requires the automation to be installed in the project named by its URL. Install it with the automation name in the path and an empty request body:

```bash
curl --fail-with-body --silent --show-error --request POST \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/$TALE_AUTOMATION" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{}'
```

The first installation returns `201`; repeating it returns `200`. A request to the collection `/automations` does not install anything. Read the deployed version’s input contract before sending a delivery.

## Create and protect the trigger

For this new test automation, bind a webhook trigger:

```bash
curl --fail-with-body --silent --show-error --request PUT \
  "$TALE_BASE_URL/api/v1/automations/$TALE_AUTOMATION/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{"kind":"webhook"}'
```

Copy the returned `token` into the private environment variable `TALE_WEBHOOK_TOKEN`. Tale returns the plaintext only when creating or rotating the token. A later read cannot recover it.

<Warning>

The URL is a credential. Anyone with it can submit deliveries. Keep it out of source, screenshots and public logs. Binding a webhook replaces any existing trigger kind on that automation; do this on the test automation you selected.

</Warning>

The trigger follows the automation name and uses its deployed version. A later deployment can therefore change what the same URL executes. If the URL leaks, rotate or remove the trigger; disabling it only suspends it and re-enabling restores the same token.

## Send one delivery

Post the test event with a stable delivery ID:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/projects/$TALE_PROJECT_ID/automations/webhook/$TALE_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  --data '{"orderId":"12345","amount":199.0}'
```

An accepted response is `202` with `runId`. Store that ID as `TALE_RUN_ID`. The automation receives `{"trigger":"webhook","payload":<body>}`, so the order ID is at `input.payload.orderId`. A declared input schema must describe this wrapper.

Repeat the same command. Within the deduplication window, the response keeps the original `runId` and adds `duplicate: true`; no second run starts. IDs are retained for 24 hours. Without an ID header, identical request bytes are deduplicated only within two minutes. Use a new ID for a genuinely new event.

## Verify the run result

Use your API key to read the run in the same project:

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$TALE_RUN_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Wait for a terminal status and inspect `output` and `trace`. In the input-returning test automation, confirm that the received payload contains the order ID and amount you sent. A `202` delivery response alone does not prove this result.

## Recover the delivery

| Response | Recovery |
| --- | --- |
| `400` | Read `code` and input issues. Fix the payload wrapper or remove a `projectId` query parameter. |
| `403` | Check that the project is active and the automation is installed there. |
| `404` | Check the token and trigger enablement. The endpoint does not reveal which is wrong. |
| `409` | Read `code`: deploy a version, correct the URL scope or resolve the delivery-scope conflict. |
| `413` | Reduce the payload below 256 KiB or send a reference. |
| `429` | Wait for `Retry-After`, then retry with the same delivery ID. |

Retry network failures and temporary server errors with bounded backoff and the same ID. Fix other client errors before retrying; repeated invalid requests cannot repair configuration. Remove the test trigger when you no longer need its URL. The [webhook reference](/develop/webhooks) lists all accepted ID headers, rotation behavior and limits.
