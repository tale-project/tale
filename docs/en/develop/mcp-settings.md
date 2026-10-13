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
| `automation-approval`  | The writes to outside systems one automation may make without a person approving each run, named as a step names them, such as `slack.send_message`, with the writes its latest version makes and who allowed each. Read only; its acts change it. | Allow or withdraw a write (`grant`, `revoke`) | Owners and admins; developers read it |
| `deployment`           | The deployment's own settings, shared by every organization on it, such as the sandbox runtime.                                                                              | Set                                                            | An owner or admin of any organization on the deployment reads them, with their own API key; only the addresses on the deployment's editor allowlist change them. A key made for another member, a team, a project or the organization reaches none of them |

A resource has an id within its kind: a provider by its name, a credential as `<provider>/<name>` with the name URI-encoded, a policy by its key such as `password_policy`, a project by its id, an agent as `<projectId>/<agentId>`, a task as `<projectId>/<taskId>` and an automation's allowances by the automation's name, such as `ops/morning-digest`. The embedding model, the branding and the deployment settings have no id. `get_settings` lists project and agent settings page by page over the projects you can read, and the automations that have an allowance; it reads a task's description and its review context, and an automation that has no allowance, only by id.

Some changes stay in Tale:

- Every secret, such as a provider's API key, a subscription or the moderation provider's key, is entered by a person in Tale.
- The retention policy and the data subject request policy change through their own staged workflows.
- Branding images are uploaded in Tale. A file name an agent sets must name an image already uploaded.
- Over MCP, the embedding model itself changes only while the knowledge base holds no document and no website, so that vectors from two models never meet in one search. Its similarity floor and serving limits change at any time; with documents indexed, a person changes the model in Tale.
- A project's standard agent follows the `standard_agent` policy, which the `governance` kind changes; its own instructions, tools and model are not settings.
- No kind covers members, teams, connectors, skills, competences, legal holds, the audit log, metrics or personal settings. `get_settings` without arguments shows what each kind covers.

## Make a change {#make-a-change}

1. Call `get_settings` without arguments. It lists every kind, whether this deployment serves it, and whether your role may read and change it.
2. Read what you want to change with `get_settings` and `kinds` (and `ids`). Each resource comes with its `key`, its `config` and its `hash`. A kind with many resources answers a page and its cursor under `cursors`; read the next page with that one kind and `cursor`.
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

## Let an automation write without approval {#automation-approval}

A write to an outside system, such as a Slack message or a new GitHub issue, waits for a person's approval on every live run, unless an owner or admin has allowed that write for that one automation. These are the **Runs without approval** switches on the automation's **General** tab (see [Respond to a waiting workflow](/platform/automations/approvals-in-workflows)); the `automation-approval` kind reads and changes the same allowances.

Read one automation's allowances by naming it: `get_settings` with `kinds: ["automation-approval"]` and `ids: ["ops/morning-digest"]`. Without `ids`, it lists the automations that have an allowance, page by page. The config is read only:

| Field              | What it holds                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowed`          | The writes that run without approval, as a step names them: `<connector>.<action>`, such as `slack.send_message`.                                                                                        |
| `used`             | The writes the automation's latest version makes.                                                                                                                                                        |
| `requiredByPolicy` | The allowed and used writes that a rule of your organization's [approval policy](/self-hosted/configuration/approvals) still requires a person for. Such a rule wins over an allowance.                  |
| `grants`           | Who allowed each write, by name, and when. A person who left the organization has no name.                                                                                                               |

An allowance changes through an act, a one-shot action on an existing resource: `grant` allows writes and `revoke` withdraws their allowance. Each takes the writes as `args.types`:

```json
{
  "changes": [
    {
      "kind": "automation-approval",
      "id": "ops/morning-digest",
      "op": "act",
      "act": "grant",
      "args": { "types": ["github.create_issue"] }
    }
  ]
}
```

Only a write to an outside system of a connector can be allowed. A read, and a write on Tale itself such as creating a task, never waits for approval. Allowing a write takes a person out of that automation's live runs, so the plan names the effect `removes-human-approval` at critical risk; put it first when you show the plan to the person. Withdrawing an allowance carries no such effect: the write asks for approval again. A change leaves the other allowances as they are, and its hash covers the automation and its allowed writes alone, so a new version of the automation does not make a plan stale, but another person's change to the allowances does. Owners and admins change allowances; developers read them. The [audit log](/platform/admin/governance/audit-logs) records each allowance and withdrawal as made through MCP, as it does for the **General** tab.

## Read a plan's effects {#effects}

A plan's risk is the highest of its kind's base risk and its effects' risk. These are the effects the kinds served today can name:

| Effect                    | Risk     | When a plan names it                                                                                             |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `may-lock-out-members`    | critical | The sign-in lockout is on after the change, password rotation starts or gets shorter, or two-factor authentication becomes stricter |
| `signs-out-members`       | critical | The idle timeout is turned on or gets shorter                                                                    |
| `removes-human-approval`  | critical | An approval rule or a review requirement no longer asks a person, or an automation is allowed to make a write without approval |
| `changes-serving-account` | high     | A provider's endpoint changes, or another credential serves its requests                                         |
| `breaks-dependents`       | high     | The provider's active default credential is removed and nothing replaces it                                      |
| `requires-empty-corpus`   | critical | The embedding model changes, which needs an empty knowledge base                                                 |
| `restart-required`        | critical | The deployment's sandbox runtime changes                                                                         |
| `reaches-vendor`          | high     | A provider's model catalog is read again with your organization's key                                            |

The settings reference that `get_docs` returns for the topic `settings` (also `tale://docs/settings`) lists the whole vocabulary, every kind's fields and every governance policy.

## Secrets {#secrets}

No secret goes into or comes out of a settings call. A stored secret reads as `{"masked": true, "preview": "…"}`, and so does anything else in a stored setting that Tale never shows in a run's record: a key someone pasted into a policy or an instruction, a key typed into a header whose name says it holds one, or a password in an address. A header that only names the stored secret, such as `Bearer {{secret}}`, reads as written. A key inside a longer text masks the whole text. Send a masked value back unchanged to keep what is stored there, or replace the whole value. A change that carries a secret is refused with `SECRET_ARGUMENT_REFUSED`, which names where the secret was found and never its value. A person enters a new secret in Tale.

## When a change is refused {#refusals}

A refusal is data with an `error`, a `code`, a `hint` and sometimes `data`, never a failed connection. These are the codes an agent meets most often:

| Code                                                         | What it means                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SETTINGS_STALE`                                             | The resource changed since it was read. Read it again, plan against what is stored now, and apply with `data.currentHash`.               |
| `SETTINGS_INVALID`                                           | The config is not the kind's. `data.issues` names every problem by its place in the config, including a field the setting does not have and text Tale cannot store, such as a NUL character. |
| `SECRET_ARGUMENT_REFUSED`                                    | The change carries a secret. `data.places` says where.                                                                                   |
| `SETTINGS_TALE_ONLY`                                         | The change is made in Tale alone, for example a credential with a key.                                                                   |
| `USE_SUBSCRIPTION_FLOW`                                      | A subscription is connected through Tale's own flow, never set by a change. Tell the person to connect it under **Settings > AI providers**; removing one works here. |
| `FORBIDDEN`, `ORG_FORBIDDEN`, `FORBIDDEN_DEVELOPER_SETTINGS` | The person's role cannot make this change in Tale either. Retrying does not help.                                                        |
| `EMBEDDING_CORPUS_NOT_EMPTY`                                 | The embedding model changes only while the knowledge base is empty. `data` names how many documents and websites it holds.               |
| `BRANDING_IMAGE_UNKNOWN`                                     | A branding file name names no image uploaded to the organization.                                                                        |
| `APPROVAL_ALLOWANCE_INVALID`                                 | A name is no write to an outside system of a connector, so it cannot be allowed. `data.types` names them.                                |
| `PROVIDER_IN_USE`, `CREDENTIAL_IN_USE`                       | Credentials still name the provider, or the embedding model uses the credential. Change those first.                                     |

The settings reference lists the codes the settings tools answer themselves; the writer of a kind answers its own too, each with its sentence and a hint. The [MCP endpoint](/develop/mcp-endpoint#settings) page describes the tools' arguments and answers.
