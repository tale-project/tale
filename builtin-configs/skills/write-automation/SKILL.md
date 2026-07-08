---
name: write-automation
icon: lucide:workflow
description: 'Use this skill whenever you create or update an automation in a Tale organization — the installable bundle that groups workflows, agents, views, integrations, and configuration behind one manifest. Triggers include: "build an automation", "package these workflows and agents", "add a view or config field to an automation", or "make X installable". Never author a bundle without it — and never create one before listing the existing automations and ruling out extending one. For the pieces inside the bundle, use write-workflow, write-agent, write-skill, and write-integration.'
---

# write-automation

An **automation** is the installable bundle; the **workflows** inside it are the trigger→steps
definitions it runs. Installing an automation copies the whole bundle into the org and groups its
entities under the manifest folder: its agents and workflows stay inside `automations/<slug>/` and are
addressed as `<slug>/<name>` — they never join the org's global agent roster or workflow tree.

## Reuse before you create — tick every box

- [ ] List the installed and available automations first.
- [ ] One already covers the job → use it; create nothing.
- [ ] One covers it partially → extend that bundle (a view, a workflow, a config field).
- [ ] Nothing fits → only then author a new bundle.

## Bundle anatomy

```text
<slug>/                     kebab-case dir name = the automation's slug (≤64 chars)
  automation.json           the manifest — the bundle's whole contract (name/description +
                             an inline i18n block translate it; see Translations below)
  icon.svg                  the card icon
  views/*.json              the automation's UI definitions (literal display strings)
  agents/*.json             optional — automation-owned agents (see write-agent)
  workflows/**/*.json       optional — automation-owned workflows (see write-workflow)
  scripts/…                 optional assets, referenced as pack://<slug>/…
```

Caps: ≤2 MiB per file, ≤20 MiB decompressed, ≤500 entries.

## The manifest (`automation.json`)

- `name` (required — literal display string; the slug is the dir name); `description`; `icon`
  (a lucide icon name); `labels` (≤6 literal chip strings); `scope` — `org` (default) or `project`
  (bound to one project at install).
- `i18n` — per-locale overrides of `name`/`description` (and `requires.config` field labels), e.g.
  `{ "de": { "name": "…", "description": "…" } }`. The manifest translates ITSELF — there is no
  separate label catalog; see Translations below.
- `workflows` / `agents` — the slugs of the bundle's own definitions.
- `integrations` — integration slugs whose DEFINITIONS the install copies into the org
  (connector + config, never credentials — those are collected per-org by the setup wizard).
- `roles` — role token → agent slug (e.g. `"reviewer": "<slug>/desk-reviewer"`), the cast the
  views can assign work to.

## The `requires` grammar — the readiness contract

What must be provided per-org before the automation works; it drives the setup checklist:

- `requires.integrations` — slugs whose **credential** must be connected.
- `requires.config` — form fields the install wizard collects (non-secret, app-level): each field
  has `key`, `type`, a literal `label` (+ optional `placeholder`/`help`), and optionally `optional`,
  `multiline`, and `derive` (`pattern` + `into` — split one input into derived keys, e.g. a repo URL
  into `owner`/`repo`). Translate a field's copy via `i18n.<locale>.config.<key>` (see Translations).

## The `capabilities` allowlist — what views may DO

A view action can never act beyond the manifest's declared surface:

- `capabilities.workflows` — the only valid `trigger_workflow` targets.
- `capabilities.roles` — the only valid `assign` targets. Plus `capabilities.queues`.
- `capabilities.functions` — the exact platform functions views may call, each entry
  `{ "path": "<dir>/<file>:<export>", "mode": "query" | "mutation" | "action" }`. Anything not
  listed is refused at dispatch and rejected at publish.

## Translations

An automation translates ITSELF — there is no separate per-bundle label catalog (a retired
`messages/<locale>.json` dir is accepted on upload but silently ignored). Add an `i18n` block to
`automation.json` with one entry per non-English locale carrying `name`/`description` overrides (+
`config.<key>.label`/`placeholder`/`help` for `requires.config` fields); an absent locale or field
falls back to the top-level literal. View documents (`views/*.json`) hold literal display strings
only — they are platform-owned UI, not bundle-translated. Ship native `de`/`fr` copy for a builtin
per `write-translations`.

## Validation

Publish/upload rejects a broken bundle with a precise error — `INVALID_BUNDLE`, `INVALID_VIEW`,
`VIEW_BINDING_NOT_ALLOWED` (a view calls a function outside `capabilities.functions`) — so nothing
broken lands on an org. Bundled workflows also pass full definition validation. Keep the manifest
minimal and every referenced slug real.

Siblings: `write-workflow`, `write-agent`, `write-skill`, `write-integration` — author the pieces
with their own skills, then compose them here.
