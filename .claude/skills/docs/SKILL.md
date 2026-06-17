---
name: docs
description: How to write and edit pages under docs/. Read before writing/editing any docs page, the nav, or the docs build. Translation rules live in the companion translation skill — this skill covers structure and voice; that one covers cross-locale work. Page-type playbooks, worked examples, mechanics, screenshots, and workflow live in companion files in this directory.
---

# docs

Tale's docs read as one narrator. The reader is a capable peer who landed cold from a search result and wants to understand the product — not be sold to, not be hand-held, not be congratulated. Every page tells them what the thing is, who it's for, why it exists, then walks them through it. This file is the contract: the five rules that fail review, the voice register, the three-part page shape, the six page types, and where each kind of page lives. Cross-locale work is the companion [`translation`](../translation/SKILL.md) skill; running the test suite is [`docs-check`](../docs-check/SKILL.md).

Closed lists — strike words, half-compound patterns, the formal-pronoun denylist — live in test data, not here; this file teaches the voice well enough that those lists rarely fire. Depth lives in companions, read by name when you need them: [PLAYBOOKS.md](PLAYBOOKS.md) (the seven page-type playbooks), [EXAMPLES.md](EXAMPLES.md) (three worked rewrites — opening, closing, walk-through), [MECHANICS.md](MECHANICS.md) (frontmatter, filenames, code blocks, tables, lists, Mermaid, links), [SCREENSHOTS.md](SCREENSHOTS.md) (capturing and embedding images), and [WORKFLOW.md](WORKFLOW.md) (the pre-PR commands and the fix-first order when a test fails).

## What fails review

**Rule 1 — Docs ship with code.** If a pull request alters what a user sees, configures, or interacts with — a feature, a setting, an environment variable, an API response, a CLI flag, a removal — the same PR updates the docs in every base locale (`en`, `de`, `fr`). Regional variant trees (today `de-CH`; more may come) are sparse: only override pages whose wording genuinely differs from the base. Code without docs is incomplete work and does not merge.

**Rule 2 — Every page has a real opening and a real closing.** The block of prose between the frontmatter and the first sub-heading, list, table, or fenced code block contains at least two complete sentences and answers _what is this_, _who is it for_, _why does it exist_. The last sub-section is named for what it does (`## Build one`, `## Where this fits`, `## When to reach for it`) and contains at least one paragraph that recaps the load-bearing idea and one paragraph that introduces the next page in context. `## Next` and `## See also` headings whose body is a single link line are stubs and fail. Enforced by [`services/docs/tests/structure-opening.test.ts`](../../../services/docs/tests/structure-opening.test.ts) and [`structure-closing.test.ts`](../../../services/docs/tests/structure-closing.test.ts).

**Rule 3 — Translations match the shipped UI verbatim.** Every name of a button, menu, panel, or feature in a translated page matches `services/platform/messages/<locale>.json` character for character. Half-English, half-translated sentences (`Öffne **Settings > Members**`) fail. The full translation contract lives in the companion [`translation`](../translation/SKILL.md) skill.

**Rule 4 — Claims are verified against the code.** Every factual claim — a UI label, an env var name, a default value, a behaviour, a route, a limit, a role's permission — is verified against the current source before the page is considered done. The sources of truth: `services/platform/messages/<locale>.json` for UI labels, `services/platform/app/` for routes and screens, `services/platform/convex/` for backend behaviour, `docker-compose.*.yml` for defaults and ports, the env loader for variable names and defaults. Voice rules cover _how_ the page reads; this rule covers _whether the page is true_.

**Rule 5 — One narrator.** Same calm, opinionated, second-person-informal voice across every page and every locale. A page that drifts into marketing softening, first-person `we`, bureaucratic passive, or status chatter fails even if every other rule passes.

## The voice

The narrator is a peer who has shipped a similar product and is telling you how this one works.

| Version          | Sample                                                                                                                                                                          | Why it fails                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Marketing soft   | Simply click **Save** and you're all set! Feel free to add as many providers as you like.                                                                                       | "Simply", "all set", "Feel free to", `!`. |
| First-person we  | We recommend you click **Save** after configuring each provider, since we sync them in the background.                                                                          | "we", missing why.                        |
| Imperative naked | Click **Save**.                                                                                                                                                                 | No why — what does Save _do_ here?        |
| **Tale voice**   | Click **Save**. The new provider is reachable from agents on the next request — there's no separate rollout step, and existing conversations keep their previous model binding. | Imperative, why present, no fluff.        |

Three guardrails the voice always respects:

- **Second person, informal.** `you` in English, `du` in German, `tu` in French. Never `we`, never `the user`, never `Sie`, never `vous`.
- **Imperative for instructions.** `Run tale deploy` — never `You can run tale deploy`, never `Please run tale deploy`.
- **Why before what.** Every command names the _consequence_ — what the command does, what breaks when you skip it. The mechanical step follows.

Closed lists — the 12-word EN strike list, the DE bureaucracy patterns, the FR marketing softeners — live in test data ([`packages/ui/src/i18n/tests/locales/<locale>/voice.ts`](../../../packages/ui/src/i18n/tests/locales/)). The tests catch the obvious slips; the voice paragraph above is what the writer reads to internalise the register.

## Every page has three parts

The opening, the body, and the closing. Every page. No exceptions.

**The opening (2–4 sentences of prose).** Immediately after the frontmatter, before any heading or list. Names the thing, the audience, and the reason it exists. For tutorials, names the outcome and the prerequisites in one sentence.

**The body.** Whatever sits between the opening and the closing. Prose is the default — lists are for parallel items of five or more. A heading owns a paragraph, not a list. Tables are for data with row-level identity. Code blocks lead with their effect. UI walk-throughs follow _effect → location → action_: `To add a person to your organisation, open **Settings > Members** and click **Invite member**` — never `Click Settings, then Members, then Invite member; this adds a person`.

**The closing (one or two paragraphs).** Named for what it does (`## Build one`, `## Where this fits`, `## When to reach for it`, `## What to read next`). Recaps the one thing the reader should remember (one paragraph), then introduces the next page in context (one paragraph with the link inline). `## Next` headings whose body is a single bullet line are stubs and fail.

See [EXAMPLES.md](EXAMPLES.md) for an opening rewrite, a closing rewrite, and an effect-first walk-through.

## Page types

Seven shapes cover everything in `docs/`. The full per-type playbook (where they live, the shape contract, the pattern example, the common failures) lives in [PLAYBOOKS.md](PLAYBOOKS.md). The table below is a routing aid.

| Type             | What it does                                                    | Canonical example                                                                                                                       |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Concept          | Hand the reader the mental model                                | [`docs/en/platform/agents/concepts.md`](../../../docs/en/platform/agents/concepts.md)                                                   |
| Tutorial         | Walk a fresh instance from "I want to do X" to a working result | [`docs/en/tutorials/editor/first-agent-end-to-end.md`](../../../docs/en/tutorials/editor/first-agent-end-to-end.md)                     |
| Reference        | Be the single source of truth for a feature, API, or config     | [`docs/en/self-hosted/configuration/providers.md`](../../../docs/en/self-hosted/configuration/providers.md)                             |
| Section overview | Frame an area for someone who landed on the section root        | [`docs/en/platform/admin/overview.md`](../../../docs/en/platform/admin/overview.md)                                                     |
| Troubleshooting  | Map symptoms to fixes for issues maintainers have actually seen | [`docs/en/self-hosted/operate/observability/troubleshooting.md`](../../../docs/en/self-hosted/operate/observability/troubleshooting.md) |
| Integration      | Walk a specific third-party pairing                             | [`docs/en/tutorials/admin/meeting-transcription.md`](../../../docs/en/tutorials/admin/meeting-transcription.md)                         |
| Glossary table   | Searchable source of truth for a closed set                     | [`docs/en/self-hosted/configuration/environment-reference.md`](../../../docs/en/self-hosted/configuration/environment-reference.md)     |

## Taxonomy

| Directory      | Tab         | Audience                                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `cloud/`       | Cloud       | Managed-SaaS readers — onboarding, billing, data residency, trust, compliance.                                |
| `self-hosted/` | Self-hosted | Operators running Tale on their own infrastructure, plus end users of those instances split by role.          |
| `platform/`    | Platform    | Product feature reference. Identical for Cloud and Self-hosted. The single source of truth for every feature. |
| `develop/`     | Develop     | API consumers, webhook integrators, SDK users, source contributors.                                           |
| `legal/`       | (footer)    | Privacy policy, terms of service, DPA. `noindex: true`.                                                       |

**The `platform/` vs `self-hosted/configuration/` boundary.** `platform/` is the UI — anything a user does inside the running app (click, fill, toggle in `Settings > …`). `self-hosted/configuration/` is server-side — filesystem access, config files (`TALE_CONFIG_DIR/**`), env vars, CLI, SOPS, Docker. When the same feature has both a UI path and a config-file path, `platform/` describes only the UI path and links to the self-hosted reference for the file form. Never paste a JSON config snippet or an env-var table into a `platform/` page; those contradict the Cloud reader's reality and belong one tab over.

## Translation

Translated pages — anything under `docs/de/`, `docs/fr/`, `docs/de-CH/` — live under the contract in the companion [`translation`](../translation/SKILL.md) skill. Read it (and its per-locale companion `locales/<locale>/AGENTS.md`) before editing any page in a non-English tree. This skill covers the docs-specific shape (opening, closing, page types, nav, lifecycle); the translation skill covers the cross-locale voice, the three-bucket loanword policy, the per-locale tone rules, and the test-data lists that catch drift.

The one load-bearing point this skill repeats from the translation skill: **UI labels in translated pages match the shipped string in `services/platform/messages/<locale>.json` character for character.** Half-translated walkthroughs (`Öffne **Settings > Members**`) fail Rule 3. Everything else — bucket policy, drift catalogues, glossary workflow — is in the translation skill.

## Mechanics

Frontmatter (`title`, `description`), filenames (dash-case lowercase), headings (sentence case, max H4), code blocks (always carry a language identifier, lead with effect), tables (`Name | Type | Required | Description` for parameters), lists (5+ parallel items only), Mermaid (one screen per diagram, translate node labels per locale), cross-references (anchor text describes the destination). The full reference lives in [MECHANICS.md](MECHANICS.md).

## Workflow

Run these before every PR (`services/docs` has no `format` script — formatting is repo-wide via root `oxfmt` and the edit hook):

```bash
bun run --filter @tale/docs lint      # oxlint --type-aware
bun run --filter @tale/docs test      # structural + prose + terminology + i18n
bun run --filter @tale/docs build     # search index, prerender, llms.txt, sitemap, robots.txt
```

When a test fails: navigation parity first, frontmatter second, locale outline third, terminology / pronouns / loanwords fourth, opening / closing fifth. Reading and triaging the suite is [`docs-check`](../docs-check/SKILL.md); full sequencing in [WORKFLOW.md](WORKFLOW.md).
