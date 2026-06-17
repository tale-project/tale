# Automations — Manual Test Plan

> **Purpose**: Exercise workflow automations — the list, the create dialog, the
> flow editor and its configuration/triggers tabs, the in-editor tester, webhook
> triggers firing into the executions list, and the metrics dashboard.

## Scope & routes

| Surface         | Route                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| List            | `/dashboard/{org}/automations`                                              |
| Editor (canvas) | `/dashboard/{org}/automations/{slug}`                                       |
| Tabs            | `/dashboard/{org}/automations/{slug}/{configuration\|triggers\|executions}` |
| Metrics         | `/dashboard/{org}/automations/metrics`                                      |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). In mode A the seeded `test`
workflow is present and runnable end-to-end.

> **Agent note**: an execution reaching `completed` is the terminal signal (the
> e2e suite allows a ~90 s budget for a real run). Adding a step on the canvas
> may be a stub — verify current behaviour rather than assuming. On a fresh org
> the list can show empty if the cold-load `listWorkflows` query briefly fails
> auth before the session settles — reload if the seeded `test` workflow doesn't
> appear (a real cold-load gating gap, logged as an issue).

## Automated coverage

| Case(s)            | Status            | e2e spec                    |
| ------------------ | ----------------- | --------------------------- |
| F9                 | ✅ automated      | `automation.spec.ts`        |
| F2, F3, F5, F6, F7 | ✅ automated      | `automation-editor.spec.ts` |
| F4, F8, F10, F11   | 🔶/⛔ manual-only | —                           |

## Functional tests

| ID  | Test                | Steps (route + control)                                                                                                                                                                         | Expected                                                                                                     |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F1  | List loads          | `/dashboard/{org}/automations`                                                                                                                                                                  | List (`automations.title`) or empty state (`emptyStates.automations.title`); seeded `test` present in mode A |
| F2  | Create              | **Create** (`automations.createButton`) → `createDialog.title`; pick **Template** (`tabTemplate`) or **Blank** (`tabBlank`) → name (`namePlaceholder`) → **Continue** (`createDialog.continue`) | Editor opens on the new automation                                                                           |
| F3  | Configuration       | Configuration tab → name (`automations.configuration.name`) + description (`automations.configuration.description`); timeout / retries / backoff / variables → **Save**                         | Persists on reload                                                                                           |
| F4  | Add step            | Editor → **Add step** (`automations.steps.toolbar.addStep`)                                                                                                                                     | A step is added (or the known stub behaviour is observed and logged)                                         |
| F5  | Test run            | **Test** (`automations.steps.toolbar.testAutomation`) → panel (`automations.sidePanel.testAutomation`) → **Execute** (`automations.tester.execute`)                                             | Result reaches **Completed** (`automations.tester.result.completed`)                                         |
| F6  | Webhook trigger     | Triggers tab → webhooks (`automations.triggers.webhooks.title`) → **Create** (`createButton`)                                                                                                   | Webhook created (`createdTitle`) with a callable URL                                                         |
| F7  | Webhook fires       | POST to the created webhook URL                                                                                                                                                                 | A new run appears in the **Executions** list                                                                 |
| F8  | Executions filters  | Executions tab → filter by status / date / triggered-by / query                                                                                                                                 | List narrows to matches; URL carries the filter params                                                       |
| F9  | Run seeded workflow | Open the `test` workflow → run to completion                                                                                                                                                    | Execution reaches `completed`                                                                                |
| F10 | Delete              | Row **⋯** (`common.actions.openMenu`) → **Delete** (`common.actions.delete`)                                                                                                                    | Automation removed                                                                                           |
| F11 | Metrics             | `/dashboard/{org}/automations/metrics` (`automations.metrics.title`)                                                                                                                            | Cross-automation metrics render                                                                              |

## Boundary & error tests

| ID  | Test               | Input                                           | Expected                                          |
| --- | ------------------ | ----------------------------------------------- | ------------------------------------------------- |
| B1  | Empty name         | Create / save with empty name                   | Required validation; blocked                      |
| B2  | Bad variables JSON | Enter malformed JSON in configuration variables | Parse error surfaced; save blocked                |
| B3  | Bad numerics       | Negative timeout / retries                      | Validation; save blocked                          |
| B4  | Failing run        | Run a step that errors                          | Execution ends `failed` with a reason, not a hang |

## Accessibility (WCAG 2.1 AA)

| ID  | Check  | Expected                                                             |
| --- | ------ | -------------------------------------------------------------------- |
| A1  | Canvas | Nodes have accessible names; a non-drag path exists (side panel)     |
| A2  | Tester | Run result announced (`aria-live` / status)                          |
| A3  | Tabs   | Configuration/triggers/executions tabs labelled + keyboard reachable |

## Performance

| ID  | Metric      | Target                         |
| --- | ----------- | ------------------------------ |
| P1  | Editor load | Canvas renders < 2 s           |
| P2  | Execution   | Seeded `test` completes < 90 s |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Automations
Functional: ___/11   Boundary: ___/4   A11y: ___/3   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
