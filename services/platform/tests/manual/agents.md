# Agents — Manual Test Plan

> **Purpose**: Exercise the agent workforce — the list, the multi-tab agent
> editor (general, instructions, tools, knowledge, skills, delegation, response
> tuning, conversation starters, webhook, metrics, history), the organigram, and
> the workforce dashboard.

## Scope & routes

| Surface           | Route                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List              | `/dashboard/{org}/agents`                                                                                                                                         |
| Editor (tabs)     | `/dashboard/{org}/agents/{slug}/{general\|instructions\|tools\|knowledge\|skills\|delegation\|response-tuning\|conversation-starters\|webhook\|metrics\|history}` |
| Organigram        | `/dashboard/{org}/agents/organigram`                                                                                                                              |
| Workforce metrics | `/dashboard/{org}/agents/metrics`                                                                                                                                 |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). In mode A the seeded
`E2E Assistant` agent is present. Create throwaway agents for edit tests and
delete them after.

> **Agent note**: the editor tabs are a real nav (`common.aria.agentsNavigation`).
> Each tab saves via the global Save bar; verify by reload, not the toast. Note
> the **Metrics** tab is labelled "Performance" (`settings.agents.navigation.metrics`).

## Automated coverage

| Case(s)                     | Status         | e2e spec               |
| --------------------------- | -------------- | ---------------------- |
| F1, F2, F14                 | ✅ automated   | `agents.spec.ts`       |
| F5, F6, F7, F10, F11        | ✅ automated   | `agent-editor.spec.ts` |
| B1                          | ✅ automated   | `validation.spec.ts`   |
| F9, F12, F13, F15, F16, F17 | ⛔ manual-only | —                      |

## Functional tests

| ID  | Test            | Steps (route + control)                                                                                                                                                       | Expected                                                                    |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| F1  | List loads      | `/dashboard/{org}/agents`                                                                                                                                                     | Table (`settings.agents.title`); seeded `E2E Assistant` listed              |
| F2  | Create agent    | **Create** (`settings.agents.createAgent`) → name (`settings.agents.form.name`) + display name (`form.displayName`) → **Continue** (`createDialog.continue`)                  | Editor opens for the new agent                                              |
| F3  | Tab nav         | Open each editor tab (`settings.agents.navigation.{general,instructionsModel,tools,knowledge,skills,delegation,responseTuning,conversationStarters,webhook,metrics,history}`) | Each renders without error; URL reflects the tab                            |
| F4  | General         | General tab → display name, description, team binding, task timeout → **Save**                                                                                                | Persists across reload                                                      |
| F5  | Instructions    | Instructions tab → system prompt (`settings.agents.form.systemInstructions`) + model select → **Save**                                                                        | Saved toast (`settings.agents.agentSaved`); persists                        |
| F6  | Tools           | Tools tab → toggle a custom tool + set web-search mode (`settings.agents.tools.modeTool`) → **Save**                                                                          | Persists                                                                    |
| F7  | Knowledge       | Knowledge tab → RAG retrieval mode (`settings.agents.knowledge.modeTool`) → **Save**                                                                                          | Persists                                                                    |
| F8  | Skills          | Skills tab → bind a skill → **Save**                                                                                                                                          | Persists; over the per-agent max is blocked                                 |
| F9  | Delegation      | Delegation tab → add a delegate in the editor                                                                                                                                 | Delegate added to the graph                                                 |
| F10 | Response tuning | Tuning tab → expand (`responseTuning.overridesSummary`), set effort (`responseTuning.effort` → `effortMedium`) → **Save**                                                     | Persists                                                                    |
| F11 | Starters        | Starters tab → **Add** (`conversationStarters.add`) → type (`conversationStarters.placeholder`) → **Save**; reorder                                                           | Persists; per-locale starters supported                                     |
| F12 | Webhook         | Webhook tab → configure URL                                                                                                                                                   | Saved; payload contract shown                                               |
| F13 | Metrics         | Metrics tab ("Performance")                                                                                                                                                   | Daily scorecard (runs, tokens, cost, review pass/fail)                      |
| F14 | Delete agent    | Row **⋯** (`common.actions.openMenu`) → **Delete** (`common.actions.delete`) → confirm (`settings.agents.deleteAgent`)                                                        | Agent removed from list                                                     |
| F15 | Organigram      | `/dashboard/{org}/agents/organigram`                                                                                                                                          | Org chart canvas; Humans root; drag to set delegation; edits via side panel |
| F16 | Workforce       | `/dashboard/{org}/agents/metrics`                                                                                                                                             | Workforce dashboard (`workforce.title`) with cross-agent metrics            |
| F17 | History         | History tab (`settings.agents.navigation.history`)                                                                                                                            | Past runs/changes for the agent are listed                                  |

## Boundary & error tests

| ID  | Test               | Input                            | Expected                                                     |
| --- | ------------------ | -------------------------------- | ------------------------------------------------------------ |
| B1  | Invalid slug       | Agent name with illegal chars    | `settings.agents.form.namePatternError`; create/save blocked |
| B2  | Empty display name | Clear display name, save         | Validation; save blocked                                     |
| B3  | Skills cap         | Bind more than the per-agent max | Extra selection blocked with a hint                          |
| B4  | Starters cap       | Add past the starters limit      | Add disabled at the cap                                      |

## Accessibility (WCAG 2.1 AA)

| ID  | Check             | Expected                                                                |
| --- | ----------------- | ----------------------------------------------------------------------- |
| A1  | Tab nav           | Editor tabs are a labelled `<nav>`; arrow/Tab reachable                 |
| A2  | Save bar          | Reachable and operable by keyboard                                      |
| A3  | Organigram        | Canvas nodes have accessible names; a non-drag path exists (side panel) |
| A4  | Effort radiogroup | Arrow-key navigable; selected state announced                           |

## Performance

| ID  | Metric     | Target                    |
| --- | ---------- | ------------------------- |
| P1  | Tab switch | < 1 s between editor tabs |
| P2  | Save       | Save → persisted < 2 s    |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Agents
Functional: ___/17   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
