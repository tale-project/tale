---
name: write-agent
icon: lucide:bot
description: 'Use this skill whenever you create or update an agent in a Tale organization — a chat assistant, an image generator, or an external coding agent (Claude Code / Cursor). Triggers include: "create an agent", "change an agent''s instructions, model, or tools", "give an agent a skill or integration", or an automation that needs its own agent. Never author an agent definition without it — and never create one before listing the existing agents and ruling out reuse. For the trigger→steps definitions an agent participates in, use write-workflow; for the installable bundle that groups agents, use write-automation.'
---

# write-agent

An agent is one JSON definition. Org-global agents live in the org config at
`agents/[folder/]<name>.json` — the folder is organizational only, never identity. An automation's
own agents live inside its bundle under `apps/<automation>/agents/` (see `write-automation`) and are
addressed as `<automation-slug>/<agent-slug>`. The definition must parse against the platform's
agent schema; an invalid file is rejected at save with the failing field named.

## Reuse before you create — tick every box

- [ ] List the existing agents of the org (roster + catalog) first.
- [ ] One already solves the request fully → use it; create nothing.
- [ ] One solves it partially → update it, or use it as the base and extend.
- [ ] Nothing fits → only then author a new definition.

A divergent near-duplicate of an existing agent is a defect, not a feature.

## Identity and naming

- `slug` is the canonical identity, stored **in the file** — flat lowercase `a-z0-9_-`, must start
  alphanumeric, ≤64 chars, **no `/`** (`^[a-z0-9][a-z0-9_-]*$`). Moving or renaming the file never
  changes identity.
- An automation-owned agent's effective name is the composite `<automation-slug>/<slug>` — at most
  one `/`, and only for automation-owned agents.
- Never reuse a reserved slug (`auto`, `organigram`) or overwrite a protected system agent
  (`assistant`, `workflow-assistant`).

## Required fields

- `displayName` (1–200 chars) — top level or in at least one `i18n` locale.
- `systemInstructions` (≤20 000 chars) — required for chat agents (the default kind), top level or
  in at least one locale.
- `supportedModels` — at least one model ref in `[provider:]model-id` form. Only a BYO
  external agent may leave it empty.

## The fields that matter

- `description` (≤1000) and `conversationStarters` (≤4 entries, ≤200 chars each).
- `skillBindings` — kebab-case skill slugs, **max 10**. This is the agent's whole skill set: empty
  or absent means the agent has NO skills; there is no implicit "all org skills".
- `toolNames` — platform tools the agent may call; `integrationBindings` — integration slugs it may
  operate; `workflows` — workflow slugs it may run.
- `primaryBehavior` — `chat` (default) | `image-generation` | `external-agent`. The non-chat kinds
  bypass the platform tool loop, so they reject `toolNames`/`workflows` (external-agent keeps
  `integrationBindings` as its sandbox grant set). `agentKind` (`claude-code` | `cursor`) and
  `authMode` (`managed` | `byo`) are external-agent-only; Cursor must be `byo`.
- `knowledgeMode` / `webSearchMode` — `off` | `tool` | `context` | `both`.
- Limits: `maxSteps` (1–100), `timeoutMs` (≥1000), `maxConcurrentTasks` (1–50),
  `budget` (`monthlyCents` plus `warnPct` ≤ `pausePct`).
- `roleRestriction: "admin_developer"` gates the agent to admins/developers; `visibleInChat` shows
  it in the chat picker; `routing.modelSelection` `config` | `auto` picks the model per turn.
- `i18n` — per-locale overrides of `displayName`, `description`, `conversationStarters`,
  `systemInstructions`, keyed by locale (`en`, `de`, `fr-FR`, …).
- `metadata` — `autoInstall` (seed enabled into every org), `templateCatalog`, `labels` (≤12; the
  first is the catalog section), `requires.integrations` (hard dependency — the agent is disabled
  while any listed integration is unconnected), `requires.env` (keys the install wizard collects).

## Minimal valid example

```json
{
  "slug": "faq-helper",
  "displayName": "FAQ Helper",
  "systemInstructions": "You answer questions about the company FAQ, concisely.",
  "supportedModels": ["openrouter:anthropic/claude-sonnet-4.6"],
  "skillBindings": ["web-research"],
  "visibleInChat": true
}
```

## Validation

Every save parses the file against the shared agent schema — a violation is rejected with the exact
field path and message (e.g. `supportedModels: At least one model is required.`). Keep the
definition minimal: omit optional fields instead of guessing values.

Siblings: `write-workflow` (the processes agents act in), `write-skill` (what `skillBindings`
points at), `write-integration` (what `integrationBindings` points at), `write-automation`
(bundling agents into an installable automation).
