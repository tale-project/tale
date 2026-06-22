---
title: Token sources
description: Settings > Token Sources is where Admins point a bring-your-own-key agent at an external broker that hands out a pool of LLM credentials. The agent draws one token per run and fails over to another on a rate-limit or auth error, so a single throttled or expired key never stalls the run.
---

Settings > Token Sources is for the case where one static API key is not enough: instead of binding a bring-your-own-key agent to a single secret, you point it at an external broker that returns a _pool_ of credentials. The agent picks one token per run and, if that token comes back rate-limited or expired, fails over to a different one from the same pool — up to three attempts before the run fails. It is the rotation layer under a BYO [external agent](/platform/agents/external-agent), nothing more: managed agents keep using the org gateway and ignore this page entirely.

This page covers the UI — what the list shows, the fields when you add a source, how a source binds to an agent, and what rotation actually does at run time. The broker's auth secret is write-only here; its file and environment-variable forms live one tab over under the [self-hosted configuration](/self-hosted/configuration/environment-reference) reference.

## What the list shows

Open **Settings > Token Sources** and you land on the table of sources the org has configured. Each row names the source, shows its broker endpoint, and shows the target environment variable the rotation engine injects the chosen token under (for a Claude Code agent that is usually `CLAUDE_CODE_OAUTH_TOKEN`). Search filters by name or endpoint; the **···** menu on a row edits or deletes it, and selecting rows reveals a bulk-delete bar.

A source is config only — it stores _how_ to reach the broker and _how_ to read its response, never the tokens themselves. Tokens are fetched fresh from the broker each time an agent run starts, so the list never goes stale against the broker's current pool.

## Adding a source

Click **New token source** and fill the side panel. The fields fall into three groups:

- **Identity** — a `slug` (lowercase, stable; it names the config file and the secret), a display name, and the broker **endpoint** with its HTTP method.
- **Broker auth** — how Tale authenticates _to the broker_: none, a bearer token, or a custom header. For bearer or header you enter the broker secret. The secret is write-only — it is never returned to the browser, so on edit the field shows blank and leaving it blank keeps the stored value.
- **Response mapping** — how to read the broker's JSON. `Tokens path` is a JSONPath to the array of tokens (e.g. `$.tokens`); `Token field` names the property holding each token. The optional `Status field` / `Status active value` filter out inactive tokens, and `Expiry field` (an ISO timestamp or epoch seconds/ms) drops already-expired ones before the pool is used.

Finally pick the **target environment variable** the token is injected under and the **selection strategy** — `random` (the default, picks uniformly per run) or `first` (deterministic). Saving validates the config, writes it, and makes the source immediately selectable on the agent Environment tab.

## Binding a source to an agent

A token source does nothing until an agent draws from it. Open the agent's **Environment** tab, add a row, and change its type from **Value** / **Secret** to **Token source** — a second dropdown then lets you pick which source. The row's variable name is the env var the chosen token lands in, overriding the source's own default for that agent.

Binding only takes effect for bring-your-own-key agents. A managed agent authenticates through the org gateway, so a token-source row on one is ignored with a warning rather than silently changing how the agent is billed.

## What rotation does at run time

When a bound BYO agent starts, Tale fetches the broker pool, filters out inactive and expired tokens, and injects one pick. If the run ends in a rotatable failure — a rate limit (`429`/`529`) or an auth error (`401`/`403`) — Tale swaps in a different token from the pool and re-runs, up to three tokens total, as long as enough of the run window remains. An auth error is cut short early rather than left to storm the provider's internal retries. If every tried token fails the same way, the run fails fast with a clear error instead of looping.

If the broker is unreachable, returns malformed JSON, or yields no active, unexpired token, the run fails immediately — there is no silent fallback to a static key, because a BYO agent has none.

## Removing a source

Open the **···** menu and choose **Delete**, or select rows and use the bulk-delete bar. Deleting removes the config and its stored secret. Any agent still bound to the deleted source fails its next run with a configuration error rather than falling back, so re-point or remove the binding on the agent's Environment tab first.

## Where this fits

Token sources sit beside [AI providers](/platform/admin/providers) as the second way Tale acquires model credentials: providers are the managed, gateway-routed path; token sources are the BYO, broker-rotated path for agents that bring their own keys. The natural next read is the [external agent](/platform/agents/external-agent) page for how a BYO agent is built, and the [environment reference](/self-hosted/configuration/environment-reference) for the `TALE_TOKEN_SOURCE_` form of the broker secret when you configure a source from files instead of the UI.
