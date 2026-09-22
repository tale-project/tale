---
title: Make your first API request
description: Create a key, identify your organization and find the models your integration can call.
---
Start an integration by proving three things: the key authenticates, it targets the right organization and that organization has the resources you need. This guide gets you through those checks with curl. You need a running Tale instance and permission to create API keys, normally the Developer, Admin or Owner role.

## Create a key for the integration

Open **Settings > API > REST** and select **Create API key**. Name the key for its purpose, choose an expiration and select **Create key**. Copy the value immediately; Tale displays the secret once.

<Frame caption="Use one recognizable key per integration so you can replace or revoke it independently.">

![The Create API key dialog asks for a descriptive name and an expiry before a key is generated.](/images/get-started/settings-api-keys.webp)

</Frame>

Load the secret into `TALE_API_KEY` from a secret manager or private shell environment. Set `TALE_BASE_URL` to your instance, for example `https://your-host.example.com`. Do not include a trailing `/api/v1`; the commands below add that path.

## Identify the account and organization

Call `/me` without an organization header. With one membership, it returns the key’s identity and organization. With several memberships, it returns `400 ORG_SLUG_REQUIRED` and lists your choices in `data.organizations`:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Set `TALE_ORG_SLUG` to your chosen slug, then repeat `/me` with that scope. The dashboard URL contains an organization ID; do not use it as the slug. A `400` in the first request makes curl exit with code 22 while still printing the JSON body.

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Check the successful response’s account, organization, capabilities and `key.expiresAt` before proceeding.

The key acts with its holder’s current membership and permissions. Creating several keys for one account does not create several independent roles or rate-limit budgets. Plan key replacement before expiration; `/api/v1` does not manage API keys for you.

## Find an available model

Send the organization explicitly when listing models:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

<Check>

A `200` response with a `models` array confirms this authenticated, organization-scoped request. The array may be empty; that confirms access to the endpoint, not readiness to generate a reply.

</Check>

Use a model’s `id` in chat requests and its `providerSlug` when that ID is available from several providers. A model can be listed yet unavailable to the provider account because of credit or plan restrictions. Ask an admin to check provider credentials and model access if the list is empty.

## Resolve the first error

| Response | What to do |
| --- | --- |
| `401` | Check the bearer key, expiration and revocation state. |
| `400` with `ORG_SLUG_REQUIRED` | Choose a slug from `data.organizations` in this error and send `X-Organization-Slug`. |
| `404` with `ORG_SLUG_INVALID` | The header names no organization at all — a typo, or the dashboard URL's organization ID pasted as the slug. Send the slug from `data.organizations`. |
| `403` with `ORG_FORBIDDEN` | The organization exists, but the key holder is not a member of it. Pick a slug from `data.organizations`. |
| `403` | Check the permission needed for the operation. |
| `429` | Wait as directed by `Retry-After`; read [Rate limits](/develop/rate-limits). |

If curl reports a TLS or network error before receiving JSON, check the host and certificate. Avoid disabling certificate verification in production scripts.

## Choose the next task

| You want to… | Continue with |
| --- | --- |
| Print a completed assistant reply | [Call Tale from a script](/tutorials/developer/call-tale-from-a-script). |
| Start an automation from another system | [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook). |
| Connect an MCP client | [MCP endpoint](/develop/mcp-endpoint). |
| Work with project files, tasks or runs | [API reference](/develop/api-reference). |

Use project routes under `/api/v1/projects/{id}/...` for project-scoped work. The project ID belongs in that path; the organization slug belongs in the header. Keep both explicit in your integration configuration.
