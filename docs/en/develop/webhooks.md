---
title: Webhooks
description: Inbound webhook triggers — POST to a token URL and a deployed automation runs. Token handling, rotation, idempotency, and the response codes.
---

A webhook lets an external system start a deployed automation by posting to a secret URL. It suits services that can send an order event, form submission, or other notification to a fixed destination. A `202` response confirms acceptance and gives you a run ID; it does not confirm the automation has finished.

For a guided first setup, follow [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook). This reference covers the delivery contract, scope, token lifecycle, and retry behavior.

## A worked trigger

### Prepare a deployed automation

Save and deploy an automation whose tests pass. Bind a webhook in the editor, or send `PUT /api/v1/automations/{name}/triggers` with `{"kind":"webhook"}` using an authorized API key. Copy the newly issued token immediately; it is returned once.

Choose the URL from the automation's scope:

| Work to start | URL | Requirement |
| --- | --- | --- |
| Project run | `/api/projects/{id}/automations/webhook/{token}` | Active project in the token's organization, with this automation installed |
| Organization run | `/api/automations/webhook/{token}` | Automation with no project bindings |

A project-bound automation refuses the global URL with `409 AUTOMATION_PROJECT_SCOPE_REQUIRED`. Do not add a `projectId` query parameter: both URLs reject it with `400 INVALID_QUERY`. A field inside the vendor body is input data, not a way to choose the project.

### Send one delivery

Store the complete secret URL in `TALE_WEBHOOK_URL` using your sender's secret configuration. The following request uses a stable ID for one logical event:

```bash
curl --fail-with-body --request POST "$TALE_WEBHOOK_URL" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: order-12345-paid' \
  --data '{"orderId":"12345","status":"paid"}'
```

The accepted response has the shape `{"runId":"..."}` with HTTP `202`. Save that ID alongside the sender's delivery ID. Tale passes the body to the automation inside this wrapper:

```json
{
  "trigger": "webhook",
  "payload": { "orderId": "12345", "status": "paid" }
}
```

Read the order as `input.payload.orderId`. If the automation declares an `inputs` schema, it must describe this wrapper. A body that is not JSON becomes text in `payload`. The body limit is 256 KiB (262,144 bytes), measured as bytes arrive; larger requests receive `413`.

### Follow the result

| Delivery scope | Authenticated polling route |
| --- | --- |
| Project | `GET /api/v1/projects/{id}/runs/{runId}` |
| Organization | `GET /api/v1/runs/{runId}` |

Poll with an API key whose holder can read that scope, or open the run in Tale. The webhook token starts deliveries; it is not a credential for reading REST results. Wait for a terminal run status before reporting that the work succeeded.

### Interpret delivery responses

| Status | Code/result | Recovery |
| --- | --- | --- |
| `202` | `runId` | Accepted; follow the run |
| `202` | `runId`, `duplicate: true` | Already accepted; follow the original run, no new run was created |
| `400` | `INVALID_QUERY` | Remove `projectId` from the query string |
| `400` | `AUTOMATION_INPUT_INVALID` | Correct the wrapper/schema mismatch using `data.issues` |
| `403` | `AUTOMATION_PROJECT_FORBIDDEN` | Check that the project is active, in the right organization, and has the automation installed |
| `404` | Unknown, disabled, or mistyped token; also any non-POST method | Check the saved URL and trigger state |
| `409` | `AUTOMATION_NOT_DEPLOYED` | Deploy a version whose tests pass |
| `409` | `AUTOMATION_PROJECT_SCOPE_REQUIRED` | Use the installed project's URL |
| `409` | `AUTOMATION_DELIVERY_SCOPE_MISMATCH` | Check the scope used for the original delivery ID |
| `413` | Body too large | Reduce the payload below 256 KiB |
| `429` | Sender or trigger budget exhausted | Wait at least `Retry-After` |

A refused input creates no run. Project refusals deliberately do not distinguish a missing project, archived project, or missing installation, and do not reveal the automation's name. `GET`, `HEAD`, and `OPTIONS` all receive the same `404` as an invalid token, without an `Allow` header.

## The token is the credential

The secret in the URL authorizes delivery. This endpoint does not verify a vendor HMAC signature or use an `Authorization` header. Keep the URL out of public issue reports, shared logs, and screenshots. Tale stores its hash and uses a constant-time comparison; plaintext is disclosed only when minted.

| Change | Token effect |
| --- | --- |
| `PUT` webhook with `rotateToken: true` | New token returned once; old URL stops working immediately |
| Delete/unbind the trigger | Token revoked; saved versions and run history remain |
| Replace webhook with schedule/event | Token revoked; response includes `revoked: "webhook"` |
| Bind webhook again after replacement | New token; the original does not return |
| Set `enabled: false` | URL suspended with `404`, but token retained |
| Re-enable, including a later `PUT` that omits `enabled` | The same suspended URL becomes active again |

<Warning>

After a leak, rotate or unbind the trigger. Disabling it is temporary suspension, not permanent revocation. Coordinate a token rotation with the sender and replace its stored URL before resuming deliveries.

</Warning>

Read `revoked` in scripted trigger changes so replacing a trigger type does not silently disconnect a partner that still uses the old URL.

## Idempotency and retries

Deduplication applies to the trigger and the project in its URL. The same delivery ID can start one run in each installed project. Current project activity and installation are checked before Tale returns a cached duplicate.

| Identity | Duplicate window | What must stay the same |
| --- | --- | --- |
| Delivery-ID header | 24 hours | ID value and scope; the body may differ and still counts as the same delivery |
| No delivery-ID header | 2 minutes | Byte-identical body and URL |

For header-based identity, the first present header in this priority order wins:

```text
Idempotency-Key
X-Idempotency-Key
webhook-id
X-GitHub-Delivery
X-Gitlab-Event-UUID
X-Shopify-Webhook-Id
Linear-Delivery
X-Atlassian-Webhook-Identifier
X-Request-UUID
I-Twilio-Idempotency-Token
X-Webhook-Id
```

Header names are alternatives, not separate namespaces. Forwarding a vendor's ID as `Idempotency-Key` preserves its identity. With no ID, JSON formatting changes the body bytes and may produce a new delivery. Prefer an explicit, stable event ID whenever your sender supports one.

Repeating the example request within 24 hours returns the original `runId` with `duplicate: true`. It does not rerun a failed automation. Decide separately how to recover a failed run instead of changing delivery IDs blindly.

Retry network failures and temporary `5xx` responses with bounded exponential backoff. For `429`, honor `Retry-After`. Keep the ID unchanged if a response may have been lost. Correct other `4xx` causes before retrying. Deduplication prevents extra runs within its window; it does not guarantee exactly-once effects in an external service.

## Budgets

| Budget | Refill | Burst | Charged when |
| --- | --- | --- | --- |
| Sender IP, as reported by trusted proxies | 120/minute | 240 | Before token verification |
| Verified trigger | 20/minute | 40 | For delivery admission |

Either budget can cause `429` with `Retry-After` in whole seconds and the normal error envelope. A token authenticates access to the trigger, but there is no separate sender-account identity to budget. Use the [rate-limit guidance](/develop/rate-limits) and keep the delivery ID stable while backing off.

## Choose webhook or API key

Use a webhook when the sender supports a fixed event URL. Use an API key when your client must also discover automations, choose projects, or read results. [Triggers](/platform/automations/triggers) explains setup in the app; the [API reference](/develop/api-reference) describes authenticated starts and polling.
