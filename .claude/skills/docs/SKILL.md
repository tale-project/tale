---
name: docs
description: How to write and edit pages under docs/ — voice, page shape, mechanics. Read before writing or editing a docs page, the nav, or the docs build. This skill covers structure and voice in English; cross-locale work (translated labels, per-locale grammar) lives in the companion translation skill. Page-type playbooks, worked examples, mechanics, screenshots, and the build workflow live in companion files in this directory.
---

# docs

Tale's docs read as **one narrator**: a calm, opinionated peer who shipped a similar product and is
telling a capable stranger how this one works — not selling, not hand-holding, not congratulating.
Every page says what the thing is, who it's for, why it exists, then walks it. This skill owns
structure and voice for the English source; cross-locale work — translated UI labels, per-locale
grammar, loanwords — is the companion [`translation`](../translation/SKILL.md) skill.

## When this applies

Editing or creating any page under [`docs/`](../../../docs/) (`en/`, `de/`, `fr/`), editing
[`docs/nav.json`](../../../docs/nav.json), or touching the docs build under `services/docs/`. Editing
a non-`en` page → read [`translation`](../translation/SKILL.md) too. Running or triaging the test
suite → [`docs-check`](../docs-check/SKILL.md).

## The voice — see it first

| Version          | Sample                                                                                                                                                                          | Why it fails                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Marketing soft   | Simply click **Save** and you're all set! Feel free to add as many providers as you like.                                                                                       | "Simply", "all set", "Feel free to", `!`. |
| First-person we  | We recommend you click **Save** after configuring each provider, since we sync them in the background.                                                                          | "we", missing why.                        |
| Imperative naked | Click **Save**.                                                                                                                                                                 | No why — what does Save _do_ here?        |
| **Tale voice**   | Click **Save**. The new provider is reachable from agents on the next request — there's no separate rollout step, and existing conversations keep their previous model binding. | Imperative, why present, no fluff.        |

Three guardrails the voice always holds:

- **Second person, informal** — `you` / `du` / `tu`. Never `we`, `the user`, `Sie`, `vous`.
- **Imperative for instructions** — `Run tale deploy`, never `You can run…`, never `Please run…`.
- **Why before what** — name the consequence (what it does, what breaks if you skip it), then the step.

Internalise the table; the strike lists catch the slips. The EN strike rules (`simply`, `easy`,
`seamless`, …), the DE bureaucracy patterns, and the FR softeners live in test data at
[`packages/ui/src/i18n/tests/locales/<locale>/voice.ts`](../../../packages/ui/src/i18n/tests/locales/).

## The rules

Five rules fail review. Three are also enforced by tests.

1. **Docs ship with code.** A PR that changes what a user sees, configures, or interacts with —
   feature, setting, env var, API response, CLI flag, removal — updates the docs in every base locale
   (`en`, `de`, `fr`) in the same PR. Code without docs does not merge. _Reviewer-caught._
2. **Real opening, real closing.** The prose between the frontmatter and the first
   heading/list/table/fence is ≥ 2 sentences answering _what / who / why_; the last sub-section is
   named for what it does (`## Build one`, `## Where this fits`), recaps the load-bearing idea in one
   paragraph, and sets up the next page in another. A `## Next` over a bare link line is a stub.
   \_Enforced by [`structure-opening.test.ts`](../../../services/docs/tests/structure-opening.test.ts)
   - [`structure-closing.test.ts`](../../../services/docs/tests/structure-closing.test.ts);\_ see the
     rewrites in [EXAMPLES.md](EXAMPLES.md).
3. **Labels match the shipped string** — every translated UI label is character-for-character the
   value in `services/platform/messages/<locale>.json`; no half-English `Öffne **Settings**`. The full
   contract is [`translation`](../translation/SKILL.md). _Enforced by the i18n suite._
4. **Claims are verified.** Every label, env var, default, behaviour, route, limit, and permission is
   checked against source before the page is done — labels in `services/platform/messages/<locale>.json`,
   routes/screens in `services/platform/app/`, backend behaviour in `services/platform/convex/`,
   defaults/ports in `docker-compose.*.yml` and the env loader. Voice covers _how_ it reads; this
   covers _whether it's true_. _Reviewer-caught._
5. **One narrator.** A page that drifts into marketing softening, first-person `we`, bureaucratic
   passive, or status chatter fails — even if every other rule passes. _Reviewer-caught._

Regional trees (the supported variant is `de-CH`, mirroring the UI-message variant) are sparse when
one exists: override only pages whose wording genuinely differs from the base locale.

## Patterns

The body is everything between the opening and closing:

- **Prose is the default.** A heading owns a paragraph, not a list. Lists are for 5+ parallel items.
- **Tables for data with row-level identity. Code blocks lead with their effect.**
- **Walkthroughs go _effect → location → action_:**
  - ✗ `Click Settings, then Members, then Invite member. This adds a person.`
  - ✓ `To add a person to your organisation, open **Settings > Members** and click **Invite member**.`

**`platform/` vs `self-hosted/configuration/`.** `platform/` is the UI — anything a user does inside
the running app (`Settings > …`). `self-hosted/configuration/` is server-side — config files
(`TALE_CONFIG_DIR/**`), env vars, CLI, Docker. When a feature has both, `platform/` describes only the
UI path and links to the self-hosted reference for the file form. Never paste a JSON config snippet or
env-var table into a `platform/` page — it contradicts the Cloud reader's reality and belongs one tab
over.

Seven page types cover `docs/`; the per-type shape contract, a pattern page, and the common failures
live in [PLAYBOOKS.md](PLAYBOOKS.md). Where each page lives:

| Directory      | Tab         | Audience                                                                                                      |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `cloud/`       | Cloud       | Managed-SaaS readers — onboarding, billing, data residency, trust, compliance.                                |
| `self-hosted/` | Self-hosted | Operators running Tale on their own infrastructure, plus end users of those instances split by role.          |
| `platform/`    | Platform    | Product feature reference. Identical for Cloud and Self-hosted. The single source of truth for every feature. |
| `develop/`     | Develop     | API consumers, webhook integrators, SDK users, source contributors.                                           |
| `legal/`       | (footer)    | Privacy policy, terms of service, DPA. `noindex: true`.                                                       |

## Companion files

- [EXAMPLES.md](EXAMPLES.md) — read when writing an opening, closing, or walkthrough and you want to see what passing prose looks like.
- [PLAYBOOKS.md](PLAYBOOKS.md) — read when you know the page type (concept, tutorial, reference, …) and want its shape contract + common failures.
- [MECHANICS.md](MECHANICS.md) — read for frontmatter, filenames, headings, code blocks, tables, lists, Mermaid, and links.
- [SCREENSHOTS.md](SCREENSHOTS.md) — read before adding an image.
- [WORKFLOW.md](WORKFLOW.md) — read before previewing locally or running the pre-PR suite; reading and triaging the suite itself is [`docs-check`](../docs-check/SKILL.md).
- [`translation`](../translation/SKILL.md) — read before editing any non-`en` page.
