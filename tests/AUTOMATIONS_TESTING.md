# Automations Testing Guide (AI-Directed)

> **Purpose**: Exercise the workflow automation module — creation, triggers, the step types, the action catalogue, conditions, schedules, dry-run, and execution logs — and collect defects in Issues Found. Workflows are built from a start step plus LLM / condition / action / loop steps and are fired by manual, scheduled (cron), webhook, or event triggers.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. Open `/dashboard/{id}/automations`.

> **AI Instructions**: Run in order; one finding per defect with a screenshot. Some actions require a configured integration/provider — note "needs integration" where a step can't run, rather than logging it as a builder bug.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/automations
```

## Functional tests

| ID  | Test                   | Steps                                                 | Expected                                                                                             |
| --- | ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F1  | Automations list       | Open automations                                      | Cards/list or empty state; "Create automation" button                                                |
| F2  | Create (blank)         | Create automation → blank → name → continue           | New workflow opens in the builder with a start step                                                  |
| F3  | Create from template   | Create → template tab → pick one                      | Template installs; opens in builder                                                                  |
| F4  | Add steps              | Add an LLM step, a condition, an action               | Steps appear on the canvas, connectable                                                              |
| F5  | Condition branches     | Add a condition with true/false + a custom branch key | Each branch edge is **labelled** (true/false and the custom key), not an unlabeled gray line (#1486) |
| F6  | Save & publish         | Save the workflow; publish                            | Saved state persists; draft/published state is clear                                                 |
| F7  | Manual run             | Trigger a manual run with valid input JSON            | Execution starts; result lands in Executions                                                         |
| F8  | Create schedule (cron) | Triggers → add schedule → enter a cron expression     | Created; **Create** stays disabled until a valid cron is entered (#1426)                             |
| F9  | Webhook trigger        | Configure a webhook trigger                           | Trigger URL/key shown; posting fires the workflow                                                    |
| F10 | Execution logs         | Open Executions for a run                             | Per-run status + step output visible                                                                 |

## Boundary & validation tests

| ID  | Test                     | Steps                                     | Expected                                                                                              |
| --- | ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| B1  | Create-automation gating | Open create dialog, leave name empty      | Continue disabled until name filled (#1425)                                                           |
| B2  | Invalid test-input JSON  | Enter malformed JSON in the tester, run   | "Invalid JSON" feedback; run blocked                                                                  |
| B3  | Dry run (file-based)     | Click Dry Run on a file-based workflow    | Either a real per-step preview, or a clear "not supported yet" message — never a silent no-op (#1484) |
| B4  | Long condition dropdown  | Open a condition with many branch options | Dropdown scrolls / stays within the panel; "End workflow" reachable (#1492)                           |
| B5  | Delete step              | Remove a step that others point to        | Edges update; no orphaned dangling connection                                                         |

## Action-catalogue smoke

The action catalogue includes Customer, Conversation, Product, Document, Integration, Set Variables, RAG, IMAP, Email Provider, Workflow Processing Records, Approval, Tone of Voice, OneDrive, Crawler, Website, Website Pages, and Workflow actions.

| ID  | Test                     | Steps                                                           | Expected                                                |
| --- | ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------- |
| AC1 | Set Variables            | Add a Set Variables step, define a var, reference it downstream | Variable resolves in a later step                       |
| AC2 | Customer/Product action  | Add a read action against seeded data                           | Runs; output visible in the execution                   |
| AC3 | Approval action          | Add an Approval step                                            | Run pauses for a human decision (see APPROVALS_TESTING) |
| AC4 | Each action configurable | Add each action type once                                       | Each opens a config panel without a console error       |

## API / integration tests

| ID  | Test                 | Steps                                                      | Expected                                     |
| --- | -------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| A1  | List/trigger via API | `GET /api/v1/automations/...`; trigger one                 | Lists workflows; trigger starts an execution |
| A2  | Webhook idempotency  | Fire the same webhook event twice with one Idempotency-Key | Second call does not double-run the workflow |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check                   | Expected                                                  |
| --- | ----------------------- | --------------------------------------------------------- |
| X1  | Builder keyboard access | Steps/edges reachable; config panels operable by keyboard |
| X2  | Branch labels readable  | Condition branches identifiable without relying on colour |
| X3  | Dialog focus trap       | Create/schedule dialogs trap focus + restore it on close  |

## Performance tests

| ID  | Metric           | Target                      |
| --- | ---------------- | --------------------------- |
| P1  | Builder load     | < 2 s for a medium workflow |
| P2  | Manual run start | Execution row appears < 2 s |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | ---------- |
|     |         |            |          |             |            |

## Test summary

```
Module: Automations
Functional: ___/10   Boundary: ___/5   Actions: ___/4   API: ___/2   A11y: ___/3   Perf: ___/2
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
