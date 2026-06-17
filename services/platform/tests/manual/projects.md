# Projects & tasks — Manual Test Plan

> **Purpose**: Exercise projects (identity, sharing/visibility, mode), their tabs
> (files, threads, agents, instructions, secrets, metrics), and the task
> board/list with the task detail sheet and review flow.

## Scope & routes

| Surface     | Route                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| List        | `/dashboard/{org}/projects`                                                                      |
| Overview    | `/dashboard/{org}/projects/{projectId}`                                                          |
| Tabs        | `/dashboard/{org}/projects/{projectId}/{files\|threads\|agents\|instructions\|secrets\|metrics}` |
| Tasks       | `/dashboard/{org}/projects/{projectId}/tasks/{board\|list}`                                      |
| Task detail | `…/tasks/board?task={taskId}` (deep link)                                                        |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). Create a throwaway project for
the run and cascade-delete it at the end.

> **Agent note**: cascade delete is gated — it requires ticking a checkbox AND
> typing the exact confirmation phrase before the destructive submit enables.

## Automated coverage

| Case(s)                            | Status         | e2e spec                 |
| ---------------------------------- | -------------- | ------------------------ |
| F1, F9, F16                        | ✅ automated   | `projects.spec.ts`       |
| F2, F6, F7, F13                    | ✅ automated   | `projects-depth.spec.ts` |
| B1, B2                             | ✅ automated   | `validation.spec.ts`     |
| F3, F4, F5, F8, F10, F12, F14, F15 | ⛔ manual-only | —                        |

## Functional tests

| ID  | Test                 | Steps (route + control)                                                                                                                                                                                                                              | Expected                                                                                             |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F1  | Create project       | **New** (`projects.list.createButton`) → name (`projects.create.nameLabel`) → **Create** (`projects.create.submit`)                                                                                                                                  | Project created and opens                                                                            |
| F2  | Overview edit        | Overview → rename (`projects.settings.name`) → save                                                                                                                                                                                                  | Saved (`projects.settings.saveSuccess`); persists on reload                                          |
| F3  | Sharing / visibility | Overview → **Sharing** (`projects.settings.sharing`) → set **Visibility** (`projects.settings.visibility`) to Team-only / Specific teams / Org-wide (`projects.settings.visibilityTeam` / `visibilityShared` / `visibilityOrgWide`)                  | Narrowing access shows the warning (`projects.settings.sharingNarrowingWarning`); selection persists |
| F4  | Files                | Files tab → upload a file; download; delete                                                                                                                                                                                                          | File appears, downloads, removes                                                                     |
| F5  | Threads / agents     | Threads tab → start a chat in project context; Agents tab → bind an agent                                                                                                                                                                            | Thread scoped to the project; agent binding persists                                                 |
| F6  | Instructions         | Instructions tab (`projects.instructions.label`) → edit → save                                                                                                                                                                                       | Persists on reload                                                                                   |
| F7  | Secrets              | Secrets tab → **Add** (`projectSecrets.addButton`) → name (`projectSecrets.nameLabel`) + value (`projectSecrets.apiKeyValueLabel`)                                                                                                                   | Value stored masked; edit/delete work                                                                |
| F8  | Metrics              | Metrics tab                                                                                                                                                                                                                                          | Usage stats render                                                                                   |
| F9  | Create task          | Tasks → **Create** (`tasks.actions.create`) → title (`tasks.fields.title`)                                                                                                                                                                           | Task on board and list                                                                               |
| F10 | Task fields          | Open task → status (`tasks.fields.status` → `tasks.status.in_progress`), priority (`tasks.fields.priority` → `tasks.priority.p1`), label (`tasks.labels.add`) → **Change color** (`tasks.labels.changeColor`)                                        | Fields + label color update and persist                                                              |
| F11 | Task deep link       | Open `…/tasks/board?task={id}` directly                                                                                                                                                                                                              | Task detail sheet opens for that task                                                                |
| F12 | Board ↔ list         | Edit a task on the board, switch to list                                                                                                                                                                                                             | Edit reflected in both views                                                                         |
| F13 | Review flow          | Request review on a task                                                                                                                                                                                                                             | Review notification raised                                                                           |
| F14 | Archive              | Archive a project; toggle archived view; unarchive                                                                                                                                                                                                   | Moves between active/archived                                                                        |
| F15 | Cascade delete       | Row **⋯** (`common.actions.openMenu`) → **Delete** (`projects.rowActions.delete`) → tick cascade (`projects.settings.deleteCascadeCheckbox`) + type phrase (`projects.settings.deleteConfirmPhrase`) → **Delete** (`projects.settings.deleteSubmit`) | Project and its tasks removed                                                                        |
| F16 | List + board basics  | Create a project + task, view board & list, then delete                                                                                                                                                                                              | Mirrors the automated happy path                                                                     |

## Boundary & error tests

| ID  | Test             | Input                                      | Expected                            |
| --- | ---------------- | ------------------------------------------ | ----------------------------------- |
| B1  | Empty name       | Create with empty name                     | Required validation; submit blocked |
| B2  | Delete gating    | Open delete, leave phrase empty / unticked | Destructive submit stays disabled   |
| B3  | Duplicate secret | Add two secrets with the same name         | Second rejected                     |
| B4  | Empty task title | Create task with no title                  | Required validation                 |

## Accessibility (WCAG 2.1 AA)

| ID  | Check          | Expected                                                      |
| --- | -------------- | ------------------------------------------------------------- |
| A1  | Board DnD      | A keyboard path exists to move/reorder a task (not drag-only) |
| A2  | Task sheet     | Dialog has a title, traps focus, returns it on close          |
| A3  | Secret masking | Stored value masked; reveal control labelled                  |
| A4  | Tabs           | Project tabs labelled and keyboard reachable                  |

## Performance

| ID  | Metric       | Target                    |
| --- | ------------ | ------------------------- |
| P1  | Project open | < 1.5 s                   |
| P2  | Board render | < 1.5 s with seeded tasks |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Projects & tasks
Functional: ___/16   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
