---
name: tale
description: "Edit, check, test, save, deploy and debug Tale automations through Tale's MCP server (get_automation, validate_automation, run_automation, test_automation, save_automation, deploy_automation, get_run). Use when the user asks to create or change a Tale automation, workflow, trigger or schedule, or to find out why a Tale run failed."
license: MIT
compatibility: "Needs Tale's MCP server connected (https://<your Tale>/api/v1/mcp); works with any MCP client that reads skills."
metadata:
  publisher: tale
  contract: "3.24.0"
---

# Tale

Tale runs automations: node graphs that a schedule, a webhook, a platform event or a person starts. Its MCP server lets you read, change, check, test, save and deploy them and debug their runs, with the rights of the person whose key or sign-in connects you. Every change you make is in the organization's audit log as that person's, made through a coding agent.

## When to use

- Creating or changing a Tale automation, or what starts it (a schedule, a webhook, an event).
- Finding out why a Tale run failed, and fixing the automation.
- Not for acting on real systems on your own: deploying, triggers and live runs act for real, so they wait for the person's yes.

## Before you start

- Check the connection: your tools include get_automation. If they do not, ask the person to connect Tale's MCP server (Tale shows how under Settings > API > MCP).
- Read the authoring reference once per session: get_docs, or the resource tale://docs/authoring.
- Discover instead of guessing: search_catalog and get_catalog for the node types this deployment runs.
- Name only what the organization has: list_models, list_harnesses, list_skills, list_connectors, list_agent_secrets (names only), list_projects and list_events say what exists.

## The editing loop

1. Read the automation with get_automation and note its version: it is your baseVersion. For a new one, pick a name list_automations does not show, and save it with create: true.
2. Edit the document.
3. Call validate_automation and fix every error. Read the warnings: they name what the organization lacks or a read that may fail.
4. Run it with run_automation and a realistic input until the output and the effects are right. It runs on the mocks, and nothing leaves Tale.
5. Add tests to the document and run them with test_automation.
6. Save with save_automation, passing baseVersion and a one-line message. The settings, task contract and presentation you leave out are kept.
7. Ask the person before deploy_automation, and pass expectedDeployedVersion (the version you read as live, null for none).

A save refused with AUTOMATION_VERSION_STALE means someone saved meanwhile: read data.latestVersion, merge your change into it, and save again with that baseVersion.

## Testing

- run_automation runs a draft on the mocks; test_automation runs the tests of a draft, or of a saved version (name, version) and records the verdict on it.
- start_run with mode "mock" runs a saved version on the mocks and records the run, so the person can review it in Tale. Without mode, start_run is live.

## Triggers

- Read the triggers reference first: tale://docs/triggers, or get_docs with topic "triggers".
- An automation has at most one trigger; list_triggers shows it, and set_trigger replaces it. A trigger runs the deployed version, for real.
- A webhook's token is shown once, in set_trigger's answer: tell the person to keep it in the sender's secret store, never in a document or a commit.

## Debugging a failed run

1. Read the run with get_run (or the resource tale://runs/{runId}): its status, error, failureCode and trace.
2. Read the version it ran with get_automation.
3. Reproduce it with run_automation and the run's input, and propose the smallest fix; save it only once the person agrees.
4. When the cause is outside the document (a connector nobody connected, a secret nobody stored, a model the organization does not serve), say which and where in Tale it is set.

## Reading refusals

A refusal is data, never a crash: {error, code, hint, data}. Branch on code and follow hint.

| Code | What to do |
| --- | --- |
| INVALID_ARGUMENTS | Fix every problem in data.issues at once; the tool schema says what it takes. |
| AUTOMATION_VERSION_STALE | On a save: read data.latestVersion, merge, save again with that baseVersion. On a delete: someone saved meanwhile; tell the person what changed, then delete again with expectedLatestVersion set to data.latestVersion. |
| AUTOMATION_NAME_TAKEN | The name is in use, perhaps by an automation the person cannot see: pick another name. |
| AUTOMATION_DEPLOYMENT_STALE | Another version went live meanwhile: tell the person and ask again. |
| AUTOMATION_NOT_FOUND | Check the name with list_automations; it may be one the person cannot see. |
| FORBIDDEN_DEVELOPER_SETTINGS | The person's role cannot do this. Say so; do not retry. |
| RATE_LIMITED | Wait data.retryAfterMs, then call again. |
| INTERNAL_ERROR | Tell the person data.requestId; whoever runs Tale can look it up. |

## Rules

- Ask the person before anything that acts for real or for others: deploy_automation, set_trigger, delete_automation, set_automation_projects, run_deployed, a live start_run, answer_run_ask.
- Approvals are human-only: never try to decide one.
- Never read local credential files, and never ask for, accept or print a secret (an API key, a token, a password). A document never holds one: the organization's secrets reach a run by name.

## References

- tale://docs/authoring: the automation grammar and the automation tools (get_docs).
- tale://docs/triggers: trigger kinds, their fields and the events (get_docs with topic "triggers").
- tale://docs/validation: reading a validation result, and every issue code (get_docs with topic "validation").
- tale://automations/{name} and tale://runs/{runId}: an automation and a run, as get_automation and get_run read them; write "/" in a name as %2F.
