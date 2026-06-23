# Agents — Manual Test Plan

> **Purpose**: Exercise the agent workforce — the roster (List), the multi-tab
> agent editor (General, Instructions & models, Tools, Skills, Knowledge,
> Delegation, Starters, Webhooks, Environment, plus the Performance metrics tab
> and the History snapshot menu), the Overview delegation graph (organigram),
> the Catalog, and the workforce Metrics dashboard. Mock mode (mode A) is fine
> for everything here except live agent runs (Performance/History stay empty in
> a fresh org).

## Scope & routes

The Agents area is a tabbed layout (`/agents` redirects to `/agents/all`). The
top tabs are **List → Overview → Catalog → Metrics**. The per-agent editor is a
nested route under `/agents/{slug}` with its own tab nav.

| Surface             | Route                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List (default)      | `/dashboard/{org}/agents/all` (`/dashboard/{org}/agents` redirects here)                                                                               |
| Overview (chart)    | `/dashboard/{org}/agents/overview`                                                                                                                     |
| Catalog             | `/dashboard/{org}/agents/catalog`                                                                                                                      |
| Metrics (workforce) | `/dashboard/{org}/agents/metrics`                                                                                                                      |
| Editor (tabs)       | `/dashboard/{org}/agents/{slug}/{«general»\|instructions\|tools\|skills\|knowledge\|delegation\|conversation-starters\|webhook\|environment\|metrics}` |

The editor's **General** tab is the slug index (`/agents/{slug}`, no segment).
There is **no** `/agents/{slug}/history` route — History is a dropdown button in
the editor's Save bar, not a tab. There is **no** `/agents/organigram` route —
the delegation graph lives on the **Overview** tab.

> `{slug}` for the seeded agent is **`assistant`** (display name "E2E
> Assistant"). `{org}` is the 16+ char id in the dashboard URL.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). In mode A every fresh
org is seeded with the **`assistant`** agent ("E2E Assistant") and the mock
provider (so the create dialog has a model to bind — creation is blocked without
one). Create throwaway agents for edit/delete tests; the seeded `assistant`
is safe to edit (re-save the original value) but **don't delete it**.

> **Agent note**: the editor tabs are a real labelled nav
> (`common.aria.agentsNavigation` → "Agents navigation"). Config tabs (General,
> Instructions, Tools, Skills, Knowledge, Delegation, Starters, Webhooks) save
> via the global **Save** bar (`common.actions.save`) — verify by reload, not
> the toast. The **Performance** tab label resolves from
> `settings.agents.navigation.metrics` (= "Performance"). Some tabs are
> conditional on agent type: Skills + Knowledge show only for chat agents; Tools
> shows for chat and external agents. Team binding and the visible-in-chat
> switch save on change via their own mutations (separate toasts), NOT the Save
> bar.

## Automated coverage

| Case(s)                        | Status         | e2e spec                                                           |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| F1, F3                         | ✅ automated   | `agents.spec.ts` (lists seeded agent, opens editor tab nav)        |
| F2, F13                        | ✅ automated   | `agents.spec.ts` (creates a custom agent then deletes it)          |
| F14                            | ✅ automated   | `agents.spec.ts` (renders the organigram delegation graph)         |
| F5                             | ✅ automated   | `agent-editor.spec.ts` (instructions & model: save + persist)      |
| F6                             | ✅ automated   | `agent-editor.spec.ts` (tools: web-search toggle: save + persist)  |
| F7                             | ✅ automated   | `agent-editor.spec.ts` (knowledge: retrieval mode: save + persist) |
| F10                            | ✅ automated   | `agent-editor.spec.ts` (conversation starters: save + persist)     |
| B1, B2                         | ✅ component   | `agent-create-dialog.test.tsx` (RHF + zod gating; NOT an e2e spec) |
| F4, F8, F9, F11, F12, F15, F16 | ⛔ manual-only | —                                                                  |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).
Note: `validation.spec.ts` does **not** cover agents (it gates project-delete
confirmation only); create-agent validation is the component test above.

## Functional tests

| ID  | Test                | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Expected (verifiable)                                                                                                                                                                                               |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | List loads          | `/dashboard/{org}/agents` (redirects to `/all`)                                                                                                                                                                                                                                                                                                                                                                                                                             | URL ends `/agents/all`; the **List** tab (`settings.agents.tabs.list`) is selected; row **"E2E Assistant"** (`settings.agents.title` = "Agents" header) is visible                                                  |
| F2  | Create agent        | List → **Create agent** (`settings.agents.createAgent`, a menu trigger) → **Blank** (`settings.agents.createMenu.blank`) → fill **Name** (`form.name`) + **Display name** (`form.displayName`) → **Continue** (`createDialog.continue`)                                                                                                                                                                                                                                     | URL becomes `/agents/{new-slug}`; toast **"Agent created"** (`settings.agents.agentCreated`); the new display name appears on the List after reload                                                                 |
| F3  | Editor tab nav      | Open `/agents/assistant`, then each tab via the nav (`common.aria.agentsNavigation`): General (`navigation.general`), Instructions & models (`navigation.instructionsModel`), Tools (`navigation.tools`), Skills (`navigation.skills`), Knowledge (`navigation.knowledge`), Delegation (`navigation.delegation`), Starters (`navigation.conversationStarters`), Webhooks (`navigation.webhook`), Environment (`navigation.environment`), Performance (`navigation.metrics`) | Each renders without an error boundary; URL reflects the tab segment (General has no segment)                                                                                                                       |
| F4  | General → persist   | `/agents/assistant` (General) → edit **Description** (`form.description`) → **Save** (`common.actions.save`)                                                                                                                                                                                                                                                                                                                                                                | Toast **"Agent saved"** (`settings.agents.agentSaved`); after **reload** the Description field rehydrates to the new value                                                                                          |
| F5  | Instructions        | Instructions tab → edit **System instructions** (`form.systemInstructions`) + pick a model → **Save**                                                                                                                                                                                                                                                                                                                                                                       | Toast "Agent saved"; value survives reload                                                                                                                                                                          |
| F6  | Tools               | Tools tab → toggle a tool / web-search **Tool** mode (`tools.modeTool`) → **Save**                                                                                                                                                                                                                                                                                                                                                                                          | Survives reload                                                                                                                                                                                                     |
| F7  | Knowledge           | Knowledge tab → set RAG retrieval **Tool** mode (`knowledge.modeTool`) → **Save**                                                                                                                                                                                                                                                                                                                                                                                           | Survives reload                                                                                                                                                                                                     |
| F8  | Skills              | Skills tab → bind a skill → **Save**                                                                                                                                                                                                                                                                                                                                                                                                                                        | Survives reload; binding past the per-agent cap is blocked (see B3)                                                                                                                                                 |
| F9  | Delegation          | Delegation tab → add a delegate                                                                                                                                                                                                                                                                                                                                                                                                                                             | Delegate appears in the editor's delegation list and survives reload                                                                                                                                                |
| F10 | Starters            | Starters tab → **Add starter** (`conversationStarters.add`) → type (`conversationStarters.placeholder`) → **Save**                                                                                                                                                                                                                                                                                                                                                          | New starter text survives reload                                                                                                                                                                                    |
| F11 | Webhook             | Webhooks tab → configure a URL → **Save**                                                                                                                                                                                                                                                                                                                                                                                                                                   | URL survives reload                                                                                                                                                                                                 |
| F12 | Performance (agent) | Performance tab (`navigation.metrics` = "Performance")                                                                                                                                                                                                                                                                                                                                                                                                                      | Per-agent scorecard renders without error (empty/zero state in a fresh org — runs needed for data; that's environment, not a bug)                                                                                   |
| F13 | Delete agent        | List → row **Open menu** (`common.actions.openMenu`) → **Delete** (`common.actions.delete`) → confirm in **"Delete agent"** dialog (`settings.agents.deleteAgent`)                                                                                                                                                                                                                                                                                                          | Toast **"Agent deleted"** (`settings.agents.agentDeleted`); the agent is gone from the List after reload                                                                                                            |
| F14 | Overview (graph)    | `/dashboard/{org}/agents/overview`                                                                                                                                                                                                                                                                                                                                                                                                                                          | Heading **"Organigram"** (`organigram.title`) + subtitle (`organigram.subtitle`); the delegation chart canvas renders                                                                                               |
| F15 | Metrics (workforce) | `/dashboard/{org}/agents/metrics`                                                                                                                                                                                                                                                                                                                                                                                                                                           | Heading **"Metrics"** (`settings.agents.tabs.metrics`) + subtitle (`workforce.subtitle`); period switcher (`workforce.period.label`) offers 7/30/90 days; switching updates `?period=` and the dashboard re-renders |
| F16 | History menu        | `/agents/assistant` → **History** button (`navigation.history`) in the Save bar → open                                                                                                                                                                                                                                                                                                                                                                                      | A menu of prior snapshots opens; with none, the disabled item **"No history entries"** (`settings.agents.history.empty`) shows                                                                                      |

## Boundary & error tests

| ID  | Test                   | Input                                                          | Expected                                                                                                                                          |
| --- | ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Invalid name pattern   | Create dialog → **Name** with illegal chars (e.g. `Bad Name!`) | **Continue** stays disabled; field shows `settings.agents.form.namePatternError`. (NOTE: validation fires on first keystroke — known issue #1943) |
| B2  | Empty display name     | Create dialog → fill Name, leave **Display name** empty        | **Continue** stays disabled (form invalid)                                                                                                        |
| B3  | No provider → no model | Create dialog opened in an org with no configured provider     | A warning (`createDialog.noModelsTitle`) shows and **Continue** is disabled (an agent must reference a real model)                                |
| B4  | Bad agent slug in URL  | Navigate to `/dashboard/{org}/agents/does-not-exist`           | Friendly **"Agent not found..."** (`settings.agents.agentNotFound`) — never the raw `<slug>.json` storage path                                    |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                                                                         |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Editor tab nav    | Tabs are inside a `<nav aria-label="Agents navigation">` (`common.aria.agentsNavigation`); each tab is a keyboard-reachable link |
| A2  | Save bar          | **Save** + **History** buttons reachable and operable by keyboard; Ctrl/Cmd+S triggers save when dirty                           |
| A3  | Overview canvas   | A non-drag editing path exists (the side panel), so delegation is operable without drag                                          |
| A4  | Agent-type radios | The agent-type **RadioGroup** (General tab) is arrow-key navigable; selected state announced                                     |

## Performance

| ID  | Metric             | Target                                                                        |
| --- | ------------------ | ----------------------------------------------------------------------------- |
| P1  | Editor tab switch  | < 1 s between editor tabs (warm, mock mode, local self-hosted backend)        |
| P2  | Save → persisted   | Save click → "Agent saved" toast < 2 s (mock mode, local backend)             |
| P3  | List → editor open | Row click → editor mounted < 1.5 s warm (row-hover preloads the detail route) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Agents
Functional: ___/16   Boundary: ___/4   A11y: ___/4   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
