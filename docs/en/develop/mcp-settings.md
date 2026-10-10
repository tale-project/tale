---
title: Settings over MCP
description: Let a coding agent read and change Tale settings through the MCP endpoint, within the role of the person whose API key it uses.
---

A coding agent connected to the [MCP endpoint](/develop/mcp-endpoint) can read your organization's settings, plan a change and make it with three tools: `get_settings`, `plan_settings` and `apply_settings`. It acts with the role of the person whose API key it uses. It can change what that person could change in the app, through the same checks, and the [audit log](/platform/admin/governance/audit-logs) records every change as that person's, made through MCP.

## What an agent can change {#kinds}

Tale reads and writes each kind of setting with its own code and the checks the app applies, so the role rules are the same as in the app.

| Kind                   | What it holds                                                                                                                                                                | Changes                                                        | Who can change it                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `provider`             | An AI provider your organization defined: its endpoint, API format and model catalog. The providers Tale ships are not settings.                                             | Set, delete; read its model catalog again (`refresh-catalogs`) | Owners, admins and developers                                                                      |
| `provider-credential`  | A credential that reads its key from an environment variable of the deployment. Credentials with a key or a subscription are listed without their secret and can be removed. | Set, delete                                                    | Owners, admins and developers                                                                      |
| `governance`           | One organization policy, named by its key: models and model access, budgets and limits, sign-in and session security, guardrails, sandbox quotas.                            | Set                                                            | Owners and admins                                                                                  |
| `knowledge-embedding`  | The embedding model of the organization's knowledge base, with its similarity floor and serving limits.                                                                      | Set                                                            | Owners and admins                                                                                  |
| `branding`             | The accent color and the file names of the logo and the favicons.                                                                                                            | Set                                                            | Owners and admins                                                                                  |
| `project-instructions` | A project's standing instructions.                                                                                                                                           | Set                                                            | Whoever can edit the project                                                                       |
| `agent-instructions`   | A project agent's instructions.                                                                                                                                              | Set                                                            | Whoever can edit the project                                                                       |
| `agent-tools`          | The tools a project agent may use.                                                                                                                                           | Set                                                            | Whoever can edit the project                                                                       |
| `agent-model` | The agent runtime (harness), model and provider a project agent runs on. A change applies to the runs it starts next. | Set | Whoever can edit the project |
| `task-instructions`    | A task's description.                                                                                                                                                        | Set                                                            | Whoever can change the task                                                                        |
| `task-review-context` | Whether a task's work goes to an independent review by another project agent, and which agent reviews it. Once set, the reviewer stays the same. | Set | Whoever can edit the project |
| `deployment`           | The deployment's own settings, shared by every organization on it, such as the sandbox runtime.                                                                              | Set                                                            | An owner or admin of any organization on the deployment reads them; only the addresses on the deployment's editor allowlist change them |

A resource has an id within its kind: a provider by its name, a credential as `<provider>/<name>` with the name URI-encoded, a policy by its key such as `password_policy`, a project by its id, an agent as `<projectId>/<agentId>` and a task as `<projectId>/<taskId>`. The embedding model, the branding and the deployment settings have no id. `get_settings` lists project and agent settings page by page over the projects you can read; it reads a task's description and its review context only by the task's id.

Some changes stay in Tale:

- Every secret, such as a provider's API key, a subscription or the moderation provider's key, is entered by a person in Tale.
- The retention policy and the data subject request policy change through their own staged workflows.
- Branding images are uploaded in Tale. A file name an agent sets must name an image already uploaded.
- Over MCP, the embedding model itself changes only while the knowledge base holds no document and no website, so that vectors from two models never meet in one search. Its similarity floor and serving limits change at any time; with documents indexed, a person changes the model in Tale.
- A project's standard agent follows the `standard_agent` policy, which the `governance` kind changes; its own instructions, tools and model are not settings.
- No kind covers members, teams, connectors, skills, competences, legal holds, the audit log, metrics or personal settings. `get_settings` without arguments shows what each kind covers.

## Make a change {#make-a-change}

1. Call `get_settings` without arguments. It lists every kind, whether this deployment serves it, and whether your role may read and change it.
2. Read what you want to change with `get_settings` and `kinds` (and `ids`). Each resource comes with its `key`, its `config` and its `hash`.
3. Plan the change with `plan_settings`. A `set` replaces the whole resource with its `config`, so send every field it should keep, as you read it. The plan names each change's action, its diff, its effects and its risk, or the refusal that stops it. Nothing is written.
4. Show the plan to the person and wait for their decision. Put the effects and the risk first.
5. Apply the same changes with `apply_settings`. `expected` maps each changed resource's `key` to the hash you read, or to `null` for one you create.

These are the arguments of a plan that turns on password rotation:

```json
{
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "op": "set",
      "config": {
        "minLength": 12,
        "requireUpper": true,
        "requireLower": true,
        "requireDigit": true,
        "requireSpecial": true,
        "rotationDays": 90
      }
    }
  ]
}
```

The plan answers the change with its effect on members, because rotation expires passwords that are already set. The hash is shortened here:

```json
{
  "ok": true,
  "changes": [
    {
      "kind": "governance",
      "id": "password_policy",
      "key": "governance/password_policy",
      "op": "set",
      "action": "update",
      "currentHash": "5c1f…",
      "diff": [{ "path": "/rotationDays", "before": 0, "after": 90 }],
      "effects": ["may-lock-out-members"],
      "risk": "critical"
    }
  ]
}
```

To apply it, send the same `changes` with `"expected": { "governance/password_policy": "5c1f…" }`, using the full hash. Before anything is written, every change is planned again against what is stored now. If one is refused, or a resource changed since you read it, nothing is applied. Otherwise the changes run in a fixed order across kinds, so that what a resource refers to exists first. The first failure stops the rest, and the answer lists what was `applied`, what `failed` and what was `skipped`. A change that already landed is not undone.

`apply_settings` asks the person before every call and uses a [budget](/develop/rate-limits) of its own.

## Read a plan's effects {#effects}

A plan's risk is the highest of its kind's base risk and its effects' risk. These are the effects the kinds served today can name:

| Effect                    | Risk     | When a plan names it                                                                                             |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `may-lock-out-members`    | critical | The sign-in lockout is on after the change, password rotation starts or gets shorter, or two-factor authentication becomes stricter |
| `signs-out-members`       | critical | The idle timeout is turned on or gets shorter                                                                    |
| `removes-human-approval`  | critical | An approval rule or a review requirement no longer asks a person                                                 |
| `changes-serving-account` | high     | A provider's endpoint changes, or another credential serves its requests                                         |
| `breaks-dependents`       | high     | The provider's active default credential is removed and nothing replaces it                                      |
| `requires-empty-corpus`   | critical | The embedding model changes, which needs an empty knowledge base                                                 |
| `restart-required`        | critical | The deployment's sandbox runtime changes                                                                         |
| `reaches-vendor`          | high     | A provider's model catalog is read again with your organization's key                                            |

The settings reference that `get_docs` returns for the topic `settings` (also `tale://docs/settings`) lists the whole vocabulary, every kind's fields and every governance policy.

## Secrets {#secrets}

No secret goes into or comes out of a settings call. A stored secret reads as `{"masked": true, "preview": "…"}`, and so does any credential found elsewhere in a stored setting, such as a key someone pasted into a policy in Tale. Send that value back unchanged to keep what is stored there. A change that carries a secret is refused with `SECRET_ARGUMENT_REFUSED`, which names where the secret was found and never its value. A person enters a new secret in Tale.

## When a change is refused {#refusals}

A refusal is data with an `error`, a `code`, a `hint` and sometimes `data`, never a failed connection. These are the codes an agent meets most often:

| Code                                                         | What it means                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SETTINGS_STALE`                                             | The resource changed since it was read. Read it again, plan against what is stored now, and apply with `data.currentHash`.               |
| `SETTINGS_INVALID`                                           | The config is not the kind's. `data.issues` names every problem by its place in the config, including a field the setting does not have. |
| `SECRET_ARGUMENT_REFUSED`                                    | The change carries a secret. `data.places` says where.                                                                                   |
| `SETTINGS_TALE_ONLY`                                         | The change is made in Tale alone, for example a credential with a key.                                                                   |
| `FORBIDDEN`, `ORG_FORBIDDEN`, `FORBIDDEN_DEVELOPER_SETTINGS` | The person's role cannot make this change in Tale either. Retrying does not help.                                                        |
| `EMBEDDING_CORPUS_NOT_EMPTY`                                 | The embedding model changes only while the knowledge base is empty. `data` names how many documents and websites it holds.               |
| `BRANDING_IMAGE_UNKNOWN`                                     | A branding file name names no image uploaded to the organization.                                                                        |
| `PROVIDER_IN_USE`, `CREDENTIAL_IN_USE`                       | Credentials still name the provider, or the embedding model uses the credential. Change those first.                                     |

The settings reference lists every code. The [MCP endpoint](/develop/mcp-endpoint#settings) page describes the tools' arguments and answers.
