---
title: Choose an available model
description: Understand model selection, provider catalogs and the checks that explain a missing or refused model.
---

The model picker shows what your organization can currently use, not every model a vendor sells. A usable provider credential, its model allowlist and the organization’s access rules all affect the result. An administrator manages these under **Settings > AI providers** and [Content & models](/platform/admin/governance/content-models).

## Choose automatic or explicit selection

In Chat, **Auto** selects a model for each message using the message’s characteristics, such as length, code and attached documents. It uses a lightweight heuristic, not a second AI request. Inspect a reply’s details to see which model actually answered.

Choose a specific model in the composer when you need to compare results, control the choice or use a model suited to a known task. That selection remains until you change it or return to Auto. [Arena](/platform/chat/arena-mode) lets you compare two available models with the same prompt.

Project agents and workflow model steps use their configured model. An agent’s picker distinguishes entries from different providers, even when the model ID is the same. Selecting an entry pins that provider/model pair. A model failure is reported rather than silently answered by a different model.

## Understand where the list comes from

Open **Settings > AI providers** to inspect the provider and its offered models. The catalog count describes the provider’s available definitions; it does not establish that your organization has permission or credentials to call all of them.

| Source | How models enter the catalog | When it changes |
| --- | --- | --- |
| Built-in catalog | Model definitions ship with Tale. | With a platform/catalog update. |
| OpenRouter catalog | Tale fetches OpenRouter’s list. | After a fetch or explicit refresh. |
| Provider models endpoint | Tale fetches the provider’s own model list. | After a fetch or explicit refresh. |
| No catalog | Model IDs come from the credential’s allowlist. | When an administrator edits that list. |

Azure OpenAI and Nous Portal use credential-defined model IDs. For Azure, enter your resource’s deployment names, which may differ from public model names. An empty allowlist on a provider with no catalog makes no models available.

## Refresh a fetched catalog

Owners, Admins and Developers can select **Refresh catalogs** in the settings header. Read the result for each provider: it reports the model count or the error that prevented refresh. A failed refresh is not evidence that the provider offers zero models.

Remote catalogs are cached for 24 hours and refreshed on demand when the cache is stale. The button forces a fresh attempt. A failed automatic fetch can continue serving a previous catalog or shipped defaults; a forced refresh reports the failure. A newly published model also needs to pass credential and policy checks. Built-in-only deployments have no remote catalogs to fetch.

## Find why a model is missing

Check these boundaries in order, or give the details to an administrator if you cannot edit settings:

1. Confirm the provider has an enabled, usable credential. A catalog entry by itself is not an account connection.
2. Inspect that credential’s **Model allowlist**. For a catalog provider it restricts the list; for a provider without a catalog it defines the list.
3. Check the model-access rules for the relevant organization, team or user under [Content & models](/platform/admin/governance/content-models).
4. For a project agent, check that the credential supports its selected [harness](/platform/agents/harnesses). A subscription may work only with its required runtime.

If the model is visible but a call fails, read the displayed reason. Expired credentials, provider failure, budget limits and lack of sandbox capacity are different problems. Refreshing a catalog cannot repair all of them. [AI providers](/platform/admin/providers) covers credentials; [Policies and limits](/platform/admin/governance/policies-and-limits) covers spending refusals.
