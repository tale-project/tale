# Automations — Manual Test Plan

> **Purpose**: Exercise workflow automations — the list (with its List / Catalog
> / Metrics tab strip), the create-automation split-button flow, the flow editor
> (canvas + Editor / Executions / Configuration / Triggers / History sub-tabs and
> the AI Assistant panel), the in-editor tester, webhook triggers firing into the
> executions list, the catalog, and the cross-automation metrics dashboard.
> Mock-LLM mode A is sufficient (the seeded `test` workflow runs offline).

## Scope & routes

| Surface         | Route                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| List            | `/dashboard/{org}/automations`                                              |
| Catalog         | `/dashboard/{org}/automations/catalog`                                      |
| Metrics         | `/dashboard/{org}/automations/metrics`                                      |
| Editor (canvas) | `/dashboard/{org}/automations/{slug}`                                       |
| Editor sub-tabs | `/dashboard/{org}/automations/{slug}/{configuration\|triggers\|executions}` |

`{slug}` is the workflow slug (e.g. `test`); the dynamic route file is `$amId`
but the URL segment carries the slug (`$amId.tsx` runs `urlParamToSlug(amId)`).
The Editor canvas is the index of `$amId` (no `/editor` segment in the URL).
`/catalog` and `/metrics` are also reachable from the **Catalog** / **Metrics**
tabs on the list page; the **Metrics** button (top-right of the list) also opens
the metrics route.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Mode A seeds each new
org's filesystem config with a trivial `test` workflow (`workflows/test.json`,
a single `start` step) that is runnable end-to-end offline.

> **Agent note**: a chat-style tester turn / execution reaches its terminal
> state when the result badge shows **Completed** (`automations.tester.result.completed`)
> or **Execution failed** (`automations.tester.result.failed`) — wait on that
> badge, not on text. The e2e suite budgets ~90 s for a real seeded run. On-canvas
> step editing isn't wired up yet, so the canvas is read-only: the add-step **+**
> button is disabled and node handles / edges can't be edited. **Known list gap
> (see I-1 below):** on a freshly
> seeded org the list can render the **No automations yet** empty state even
> though `workflows/test.json` exists on disk and `/automations/test` opens the
> editor — if the list is empty, open the workflow directly by slug to continue
> the editor / tester / triggers cases.

## Automated coverage

| Case(s)         | Status         | e2e spec                                                 |
| --------------- | -------------- | -------------------------------------------------------- |
| F9              | ✅ automated   | `automation.spec.ts` (runs seeded `test` to completion)  |
| F2              | ✅ automated   | `automation-editor.spec.ts` (create blank → editor)      |
| F3              | ✅ automated   | `automation-editor.spec.ts` (configuration save+persist) |
| F5              | ✅ automated   | `automation-editor.spec.ts` (tester run + lists run)     |
| F6, F7          | ✅ automated   | `automation-editor.spec.ts` (webhook fires execution)    |
| F10             | ✅ automated   | `automation-editor.spec.ts` (deletes throwaway)          |
| F1, F4, F8, F11 | ⛔ manual-only | —                                                        |
| F12             | ⛔ manual-only | — (catalog page; no spec visits `/automations/catalog`)  |
| B1, B2          | 🔶 component   | `automation-create-dialog.test.tsx` (Continue disabled until named; duplicate-name error) |
| B3, B4          | ⛔ manual-only | —                                                        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
(The 29-spec suite has no automations coverage outside `automation.spec.ts` and
`automation-editor.spec.ts`; the catalog, list-render, add-step, executions
filtering, and metrics surfaces are manual-only.)

## Functional tests

| ID  | Test                | Steps (route + control)                                                                                                                                                                                                                                                                   | Expected (verifiable)                                                                                                                                                                                                                                                          |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | List loads          | `/dashboard/{org}/automations`                                                                                                                                                                                                                                                            | H1 **Automations** (`automations.title`); **List / Catalog / Metrics** tab strip; **Create automation** split button (`automations.createButton`). Either the seeded `test` row OR the **No automations yet** empty state (`emptyStates.automations.title`) renders — see I-1. |
| F2  | Create blank        | **Create automation** (`automations.createButton`) → menu item **Blank** (`automations.createDialog.tabBlank`) → dialog **Create automation** (`automations.createDialog.title`) → name (`automations.createDialog.namePlaceholder`) → **Continue** (`automations.createDialog.continue`) | URL becomes `/dashboard/{org}/automations/{newSlug}`; canvas toolbar shows a **disabled** add-step button (`automations.steps.toolbar.addStepUnavailable`) + **Test automation** (`automations.steps.toolbar.testAutomation`)                                                  |
| F3  | Configuration saves | Open a workflow → **Configuration** sub-tab → edit **Name** (`automations.configuration.name`) / **Description** (`automations.configuration.description`) → **Save** in the nav strip                                                                                                    | Reload `/automations/{slug}/configuration`; the Description field still holds the edited value                                                                                                                                                                                 |
| F4  | Add step disabled   | Editor canvas → hover the **+** add-step toolbar button (`automations.steps.toolbar.addStepUnavailable`)                                                                                                                                                                                  | On-canvas step editing isn't wired up yet: the **+** button is disabled (cannot be clicked / opens no dialog) and its tooltip/aria-label reads the "unavailable" message. Node handles are non-connectable and edges cannot be deleted — the canvas is read-only.              |
| F5  | Tester run          | Editor → **Test automation** (`automations.steps.toolbar.testAutomation`) → tester panel (`automations.sidePanel.testAutomation`) → **Execute** (`automations.tester.execute`)                                                                                                            | Result badge reaches **Completed** (`automations.tester.result.completed`); the run is then listed under the **Executions** sub-tab                                                                                                                                            |
| F6  | Create webhook      | Open workflow → **Triggers** sub-tab → **Webhooks** (`automations.triggers.webhooks.title`) → **Add webhook** (`automations.triggers.webhooks.createButton`)                                                                                                                              | Toast / title **Webhook created** (`automations.triggers.webhooks.createdTitle`); a **Webhook URL** (`automations.triggers.webhooks.webhookUrl`) value is shown and survives reload of the Triggers tab                                                                        |
| F7  | Webhook fires       | `POST` to the created webhook URL (curl)                                                                                                                                                                                                                                                  | A new run appears under the **Executions** sub-tab (`automations.executions.title`)                                                                                                                                                                                            |
| F8  | Executions search   | `/automations/{slug}/executions` → type in **Search executions** (`automations.executions.searchPlaceholder`)                                                                                                                                                                             | The executions list narrows to matching runs; clearing the field restores the full list                                                                                                                                                                                        |
| F9  | Run seeded workflow | Open `/automations/test` → **Test automation** → **Execute**                                                                                                                                                                                                                              | Execution reaches **Completed** (`automations.tester.result.completed`) within 90 s; visible under **Executions**                                                                                                                                                              |
| F10 | Delete              | List row **⋯** (`common.actions.openMenu`) → **Delete** (`common.actions.delete`) → confirm                                                                                                                                                                                               | The row disappears; reload `/automations` and the deleted slug is absent (open `/automations/{slug}` shows **Workflow not found**)                                                                                                                                             |
| F11 | Metrics             | `/dashboard/{org}/automations/metrics`                                                                                                                                                                                                                                                    | H2 **Automation Metrics** (`automations.metrics.title`); four KPI cards **Total runs / Success rate / Avg duration / Failed runs** (`automations.metrics.cards.*`); **Runs over time** + **Status breakdown** charts; period selector (default "Last 30 days")                 |
| F12 | Catalog             | `/dashboard/{org}/automations/catalog`                                                                                                                                                                                                                                                    | **Automation catalog** (`automations.catalog.title`) renders the installable-template grid (or its empty state); no console errors                                                                                                                                             |

## Boundary & error tests

| ID  | Test             | Input                                                       | Expected                                                                                                           |
| --- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| B1  | Empty name       | Create dialog → **Continue** with the name field blank      | **Continue** stays disabled; no workflow created                                                                   |
| B2  | Duplicate name   | Create a workflow whose name collides with an existing one  | Validation **An automation with this name already exists** (`automations.validation.duplicateName`); not created   |
| B3  | Symbol-only name | Create with a name containing no letter/number (e.g. `***`) | Validation **Name must contain at least one letter or number** (`automations.validation.invalidName`); not created |
| B4  | Missing workflow | Navigate to `/automations/{nonexistentSlug}`                | Editor shows **Workflow not found: {slug}** (not a blank page or unhandled 500)                                    |

## Accessibility (WCAG 2.1 AA)

| ID  | Check           | Expected                                                                                                                         |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Canvas controls | Canvas toolbar buttons (**Add step**, **Test automation**) have accessible names (role + name), reachable without a drag gesture |
| A2  | Tester result   | The run-result badge change is conveyed to assistive tech (status text / `aria-live`, not colour only)                           |
| A3  | Editor tabs     | **Editor / Executions / Configuration / Triggers** sub-tabs are labelled and keyboard-reachable (Tab + Enter)                    |

## Performance

| ID  | Metric      | Target                                                                                                  |
| --- | ----------- | ------------------------------------------------------------------------------------------------------- |
| P1  | Editor load | `/automations/test` canvas (Start node + toolbar) renders < 2 s, mock mode A, local self-hosted backend |
| P2  | Seeded run  | Seeded `test` workflow reaches **Completed** < 90 s, mock mode A, local self-hosted backend             |
| P3  | List paint  | `/automations` paints the title + tab strip + Create button < 2 s (independent of the I-1 row-load gap) |

## Issues Found

| #   | Test ID | Route / URL                    | Severity | Description                                                                                                                                                                                                                                                                  | Screenshot                          |
| --- | ------- | ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| I-1 | F1, F9  | `/dashboard/{org}/automations` | high     | Seeded `test` workflow never appears in the list (**No automations yet** persists across 6 reloads / ~18 s) although `workflows/test.json` exists on disk and `/automations/test` opens the editor fine; agents (same scaffold) DO list. List misrepresents persisted state. | `automations/list-multi-reload.png` |
|     |         |                                |          |                                                                                                                                                                                                                                                                              |                                     |

## Test summary

```
Area: Automations
Functional: ___/12   Boundary: ___/4   A11y: ___/3   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
