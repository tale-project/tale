---
name: write-workflow
icon: lucide:git-branch
labels: ['Authoring']
description: 'Use this skill whenever you create or update a workflow in a Tale organization — a trigger→steps definition that runs on an event, on a schedule, or on demand. Triggers include: "automate this task", "build or edit a workflow", "run X every morning", "when Y happens, do Z", or an automation that needs a new process. Never author a workflow definition without it — and never create one before listing the existing workflows and ruling out reuse. The installable bundle a workflow lives in is an "automation" — for the bundle use write-automation; for the agents acting inside a step use write-agent.'
---

# write-workflow

A workflow is one JSON definition: a set of steps wired by `nextSteps`, optionally declaring its
triggers and integration dependencies. A workflow carries **no name or description** — its identity
is its slug and its intent lives in the `specification` text; the automation that owns it carries
every display string. Standalone org workflows live at `workflows/[folder/]<name>.json` — the
**slug is the relative path without extension** (e.g. `github/review-pull-request-in-github`). An
automation's single workflow lives INLINE in its `automation.json` under `workflow`, and its slug
IS the automation slug (see `write-automation`).

## Reuse before you create — tick every box

- [ ] List the existing workflows first.
- [ ] One already does the job → use it (or tell the user to edit it); create nothing.
- [ ] One does part of the job → extend that definition instead of writing a sibling.
- [ ] Nothing fits → only then author a new definition.

## Top-level fields

- `specification` (≤20000) — free-text markdown describing what the workflow does and why; the
  workflow's only prose. Keep it in sync with the graph: the editor tracks spec/graph divergence
  and offers regeneration in either direction. No `name`, `description`, or `i18n` — step names
  stay engine-internal and untranslated.
- `config` — `timeout`, `retryPolicy` (`maxRetries`, `backoffMs`), `variables` (free-form record),
  `secrets` (name → `{ "envVar": "..." }` — never a literal secret), `models` (workflow-level
  fallback chain for LLM steps that set neither `model` nor `models`).
- `triggers` — declarative intent: `events` (`eventType` + optional `eventFilter`) and `schedules`
  (`cron` + optional `timezone`, `variables`). Declaring a trigger does not fire anything by
  itself — the workflow runs only once matching subscription/schedule rows are provisioned.
- `requires.integrations` — `{ "name": "...", "operations": [...], "minVersion": n }` per
  dependency; the workflow is unusable until each named integration is connected.
- `metadata` — documented keys: `autoInstall` (provision to every org), `labels` (catalog tags).
- `steps` — the graph.

## Step shape

```json
{
  "stepSlug": "find_customer",
  "name": "Find customer",
  "stepType": "action",
  "config": { "type": "..." },
  "nextSteps": { "default": "process_order" }
}
```

- `stepSlug` matches `^[a-z0-9][a-z0-9_-]*$` — use snake_case (`find_customer`).
- `stepType` is one of `start`, `trigger`, `llm`, `condition`, `action`, `loop`, `output`,
  `sandbox`.
- `nextSteps` sits **beside** `config`, never inside it.
- `llm` steps require `name` + `systemPrompt` in config (not `prompt`); `action` steps require
  `type` in config.
- Optional: `description`, `order`, `role` (binds the step to an automation role), `ui`
  (declarative render annotation — keys only, no literal text).

## Design doctrine — LLM-first for business logic

For business-logic workflows (not data sync): action steps only fetch/store data; `llm` steps carry
all analysis, decisions, and content generation. Give the model whole records and let it decide —
don't pre-chew logic into condition chains. Use `loop` for data-sync iteration only.

## Validation

The file must parse against the shared workflow schema (field errors name the path). Saving through
the workflow tools additionally runs full definition validation — step references, required step
config, port wiring — and reports the exact failing step. Keep examples minimal and valid; omit
what you don't need.

Siblings: `write-agent` (agents referenced by roles/steps), `write-integration` (what action steps
call), `write-automation` (bundling workflows into an installable automation).
