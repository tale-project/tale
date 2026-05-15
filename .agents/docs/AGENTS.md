---
name: docs
description: The contract for writing and maintaining the Tale documentation under `docs/` and `services/docs/`. Use whenever a change touches a page in the docs tree, navigation, or docs scripts.
---

# Tale docs — the contract

This document is the binding contract for every page under [`docs/`](../../docs/). Every rule here is enforced either by the test suite in [`services/docs/tests/`](../../services/docs/tests/) or by review. If a page in the repo conflicts with this contract, the page is wrong; if a need genuinely conflicts with this contract, update the contract first in the same PR.

The contract is structured as four nested layers:

1. **Five binding rules.** The irreducible commitments. If you remember nothing else, remember these.
2. **The voice.** One narrator across the entire corpus. Calm, opinionated, why-before-what.
3. **The page shape.** Opening, body, closing — every page, no exceptions.
4. **The page-type playbooks.** Six concrete shapes for the six kinds of page the docs site contains.

Below those, the named anti-patterns catalogue gives reviewers a vocabulary for what's wrong; the translation philosophy governs every cross-locale move; the mechanics section covers frontmatter, filenames, and tables; and the workflow section closes the loop with how to ship.

> **Companion skill:** every page under [`docs/[locale]/**`](../../docs/) also has to pass the [`terminology`](../terminology/AGENTS.md) skill. Read [`.agents/terminology/AGENTS.md`](../terminology/AGENTS.md) before editing a translated page — it owns the per-locale term tables, the loanword policy, and the per-language tone rules. This skill points to those files; it does not duplicate them.

---

## The five binding rules

These are the rules that fail review (or fail the test suite) when they're broken. Everything below them is implementation.

**Rule 1 — Docs ship with code.** If a pull request alters what a user sees, configures, or interacts with — a feature, a setting, an environment variable, an API response, a CLI flag, a removal — the same PR updates the docs in every base locale (`en`, `de`, `fr`). Regional variant trees (today `de-CH`; more may come) are sparse: only override pages whose wording genuinely differs from the base. Code without docs is incomplete work and does not merge.

**Rule 2 — Every page has a real opening.** The block of prose between the frontmatter and the first sub-heading, list, table, or fenced code block contains at least two complete sentences, and answers three questions: _what is this_, _who is this for_, _why does it exist_. Enforced by [`services/docs/tests/opening-paragraph.test.ts`](../../services/docs/tests/opening-paragraph.test.ts).

**Rule 3 — Every page has a real closing.** The last sub-section is named for what it does (`## Build one`, `## Where this fits`, `## Where this gets used`, `## When to reach for it`) and contains at least one paragraph of recap that names the one thing the reader should remember, then introduces the next page with a sentence of context. `## Next` and `## See also` headings whose body is a single link line are stubs and fail review. Enforced by [`services/docs/tests/closing-paragraph.test.ts`](../../services/docs/tests/closing-paragraph.test.ts).

**Rule 4 — Translations match the shipped UI verbatim.** Every name of a button, menu, panel, or feature in a translated page matches the string `services/platform/messages/<locale>.json` ships, character for character. Translate-bucket English nouns — `Header`, `Request`, `Email`, `Help Center`, `Billing`, `Sales Research`, `Draft`, `Attachment`, `Self-hosted`, plus FR-only `Engineering` — never appear untranslated in DE/FR prose. Enforced by [`services/docs/tests/terminology.test.ts`](../../services/docs/tests/terminology.test.ts) and [`services/docs/tests/loanword.test.ts`](../../services/docs/tests/loanword.test.ts).

**Rule 5 — One narrator.** The voice on every page in every locale is the same calm, opinionated, second-person informal narrator described below. A page that drifts into marketing softening, passive bureaucracy, or first-person "we" prose fails review even if every other rule passes.

---

## The voice

Tale's docs read as one narrator. The reader is a capable peer who landed cold from a search result and wants to understand the product — not be sold to, not be hand-held, not be congratulated.

### Three guardrails the voice always respects

**Second person, informal.** `You` in English, `du` in German, `tu` in French. Never `we`, never `the user`, never `Sie`, never `vous`. The marketing site addresses the prospective customer in the same voice as the signed-in product, so the rule holds across surfaces.

**Imperative for instructions.** `Run tale deploy` — never `You can run tale deploy`, never `Please run tale deploy`, never `It is recommended to run tale deploy`. The reader did not ask for permission.

**Why before what.** Every command, every config knob, every UI walkthrough names the _consequence_ — what the command does in production, what breaks when you skip it, what the alternative would have meant. The mechanical step follows. This is the single most load-bearing voice rule; most "I read the page but still don't get it" failures trace back to a missing why.

### Twelve words to strike

`simply`, `easy`, `powerful`, `seamless`, `just`, `please`, `feel free to`, `discover`, `unleash`, `effortlessly`, `straightforward`, `intuitive`. If a thing is easy, the page demonstrating it will show that without saying it. If a thing is powerful, that's evident from what it does, not from the adjective. These words trigger reviewer rejection on sight.

### Three rhythms to avoid

- **No exclamation marks.** Outside literal code (`!important`, `1 != 2`), an exclamation belongs in a marketing splash.
- **No status chatter.** `Updated:`, `New in v1.6:`, `Coming soon:`, `TODO:`, `Note that…` have no place in prose. Release notes carry the version history; git carries the rest.
- **No "we".** Tale's docs describe a product the reader operates. The author is invisible. `We recommend…` becomes the recommendation itself; `In this guide we will…` becomes the guide itself.

### Worked voice examples

The same instruction, written four ways. Only the last is the bar.

| Version          | Sample                                                                                                                                                                          | Why it fails                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Marketing soft   | Simply click **Save** and you're all set! Feel free to add as many providers as you like.                                                                                       | "Simply", "feel free to", "!".     |
| First-person we  | We recommend you click **Save** after configuring each provider, since we sync them in the background.                                                                          | "we", missing why.                 |
| Imperative naked | Click **Save**.                                                                                                                                                                 | No why — what does Save _do_ here? |
| **Tale voice**   | Click **Save**. The new provider is reachable from agents on the next request — there's no separate rollout step, and existing conversations keep their previous model binding. | Imperative, why present, no fluff. |

The fourth version is roughly two sentences for what the first version compressed into one half-sentence. That's the bargain: longer in characters, shorter in the reader's head.

---

## The page shape

Every page — every single one — has three load-bearing parts. Skipping any of them produces the "feels cut off" failure mode the docs were drifting into for two years before this contract landed.

### The opening (2–4 sentences of prose)

The opening is not a tagline, not a TL;DR, and not a bullet list. It is two to four full sentences of running prose, immediately after the frontmatter, that answer three questions in this order:

1. **What is this?** Name the thing — the feature, the file, the role, the workflow — and what role it plays in Tale.
2. **Who is this for?** Name the audience — role, persona, situation. If the page applies to everyone, say so.
3. **Why does it exist?** Name the reason this thing exists in the product (or, for tutorials, the outcome it produces). This is where most pages fail.

The opening also pre-empts the reader's two most common questions: "is this the right page?" and "do I have the prerequisites?". If the page assumes role or feature access, the opening says so.

#### Three opening formulas that work

- **Feature reference**: `<Feature X> is <one-line definition>. <Audience> uses it for <use case>. <Reason it exists in the product, often a comparison to the next-closest concept>.`
- **Tutorial**: `<Outcome> requires <three or four moves>. This page walks all of them, end to end. <Prerequisites in one sentence.>`
- **Section overview**: `<Section X> is the part of Tale that does <Y>. <Audience> uses it for <Z>. <The order in which the sub-pages should be read, if it matters.>`

Worked examples for each formula appear in the page-type playbooks below.

### The body

The body is whatever stands between the opening and the closing. The rules below govern how it is built.

- **Prose is the default.** Lists are for parallel items of _five or more_ (commands, options, env vars). A bullet list of three items explaining a concept is almost always a paragraph wearing list clothes.
- **A heading owns a paragraph, not a list.** When the body of a section is _only_ a list, the heading is doing a paragraph's job. Add the paragraph first; let the list follow.
- **Tables are for data with row-level identity.** Use a table when you can name the rows and the columns. A two-column "feature / description" table for three items is a list pretending to be a table — write the sentence.
- **Code blocks lead with their effect.** Either a sentence before the block names what the block does, or the block ends with one or two sentences naming what changed. Naked code with no surrounding prose fails review.
- **One topic per file.** If the page drifts into a second subject, split it. The taxonomy section below covers where each subject lives.
- **Sub-section headings are sentence case** and **named for what the section does, not what it is**. Prefer `## Build one`, `## Where this fits`, `## When to reach for it` over `## Building`, `## Context`, `## Use cases`.
- **Maximum heading depth is H4.** If a page genuinely needs H5, it should be split.

### The closing

The closing recaps and connects. Two paragraphs is typical; one is the minimum.

The closing-section heading is **never** `## Next`, `## See also`, `## Weiter`, `## Suite`, or any other stub. It is named for what the section does for the reader's mental model:

- `## Build one` — for a concept page that hands off to a build page.
- `## Where this fits` — for a feature reference that explains how the feature relates to the rest of the platform.
- `## Where this gets used` — for a tutorial that lands a building block the reader will apply elsewhere.
- `## When to reach for it` — for a feature that competes with similar features in the product.
- `## Common shapes` — for a primitive that appears in many forms across the product.
- `## What to read next` — only when the page is a starting point in a learning path, and the next-read recommendation is non-obvious.

The closing's _body_ recaps the one thing the reader should remember (one paragraph, prose) and then introduces the next page (one paragraph, prose with the link in context). Bare bullet lists of `[link]` lines are stubs. The closing fails when:

- The heading is `## Next` or any of the listed stub forms.
- The body is one link line and nothing else.
- The body recaps everything on the page (it should recap _one thing_).
- The body promises the reader will "learn more about X" — this is marketing language; just _describe_ what the next page contains.

---

## Page-type playbooks

Six page types cover everything in `docs/`. Each has its own shape contract on top of the general one.

### 1. Concept page

**Where they live.** `platform/<area>/<topic>.md` for product concepts; `develop/<topic>.md` for developer concepts.

**What they do.** Hand the reader the mental model: the vocabulary, the relationships between pieces, the trade-offs. A concept page is what someone reads _before_ they touch the UI, not while they're using it.

**Shape.**

1. **Opening** (3–4 sentences): name the concept, who uses it, what it solves that the next-closest concept doesn't.
2. **The pieces** (one sub-section per piece, each with at least one paragraph of prose before any list or table): name each piece, what it controls, the consequence of the typical choice.
3. **Putting it together** (one sub-section): show one or two worked combinations of the pieces — a table is fine here, since the rows have identity.
4. **Closing** (named `## Build one`, `## Where this fits`, or `## When to reach for it`): one paragraph of recap, one paragraph linking to the next page (the build flow, the comparison page, etc.).

**Pattern example.** [`platform/agents/concepts.md`](../../docs/en/platform/agents/concepts.md) is the canonical concept page — four pieces (instructions, knowledge, tools, model), one combination table, one `## Build one` closing.

**Common failures.**

- The opening defines the concept by listing its sub-headings ("Agents have instructions, knowledge, tools, and a model"). Define the concept by what it _does_, not what it contains.
- A piece sub-section is one sentence and a bullet. Add the prose paragraph; the bullets follow.
- The closing is `## Next`. Rename it.

### 2. Tutorial

**Where they live.** `tutorials/<role>/<task>.md`.

**What they do.** Take the reader from "I want to do X" to a working result, end to end, on a fresh instance. A tutorial is a worked example — not a reference, not a concept page.

**Shape.**

1. **Opening** (3–4 sentences): the outcome you'll have at the end, the prerequisites in one sentence, where the reference for the underlying feature lives. Pre-empt the "is this the right page?" check.
2. **What you'll build** _(optional sub-section)_: one paragraph of prose plus one diagram if the workflow has more than three steps. Only include it if the outcome isn't obvious from the title.
3. **Prerequisites** (sub-section): bulleted, parallel, with specific links. List the role required, the feature access required, any third-party software, any API keys.
4. **Numbered steps** (sub-sections `## Step 1 — <action>`, etc.): each step is **one move** (create one thing, configure one thing, run one thing). Each step starts with a paragraph naming what this step accomplishes and why, then walks the mechanic, then names the verification — _how the reader knows the step worked_.
5. **Troubleshooting** (sub-section): the three or four issues the maintainer has actually seen, each as a short paragraph or three-line bullet (symptom → cause → fix).
6. **Closing** (named `## Where this fits` or `## Where this gets used`): one paragraph of recap on what the reader now knows how to do, one paragraph of "and here's the natural next move" with a contextualised link.

**Pattern example.** [`tutorials/editor/first-agent-end-to-end.md`](../../docs/en/tutorials/editor/first-agent-end-to-end.md) is the canonical tutorial — eight steps, each one move, each with a paragraph naming the consequence.

**Common failures.**

- Steps that are "Open Settings > Members" with no surrounding prose. Add the paragraph naming what the reader is configuring and why.
- A step that does three things at once. Split it.
- No verification — the reader can't tell whether step 3 actually worked. Add the sentence.
- The closing is "Run it!" or a bare link. Recap, then connect.

### 3. Reference page

**Where they live.** `platform/<area>/<feature>.md`, `develop/api-reference.md`, `self-hosted/configuration/<topic>.md`.

**What they do.** Be the single source of truth for a feature, an API surface, a config file, or an env-var inventory. A reference page is what someone consults _during_ a task, often via search.

**Shape.**

1. **Opening** (2–3 sentences): name the feature, the audience, the canonical scope of this page ("this page covers X, not Y — Y lives at <link>"). Reference pages live or die by the scope sentence.
2. **The data** (multiple sub-sections, each named for a sub-concept): tables, code blocks, env-var lists, schema fields — whatever the actual data is. Prose introduces each sub-section in 1–2 sentences before the data.
3. **Edge cases / advanced** _(optional sub-section)_: the gotchas a reader hits in production. Keep it short — if it's long, split into its own page.
4. **Closing** (named `## Where this fits`): one paragraph linking the reference to the UI counterpart (or the file counterpart), and to the conceptual page if one exists.

**Pattern example.** [`self-hosted/configuration/providers.md`](../../docs/en/self-hosted/configuration/providers.md) is the canonical reference page — schema, fields, cost rules, gateway-vs-vendor distinction, `## Where this fits` closing.

**Common failures.**

- The opening is one sentence of "Providers connect Tale to AI models". Add the scope sentence — what does _this_ page cover, where does the rest live.
- Tables with no prose introduction. Add the lead-in sentence.
- The closing duplicates the opening. Make it a real recap that introduces the related pages.

### 4. Section overview (landing page)

**Where they live.** `<area>/index.md`, `<area>/overview.md`.

**What they do.** Frame the area for someone who landed on the section root. They are _not_ link lists with a sentence on top — they are real prose framing followed by a linked index.

**Shape.**

1. **Opening** (3–4 sentences): name the area, name the audience, name why this area exists in the product. For role-indexed overviews, name what this role can do that the next-closest role can't.
2. **Context paragraph(s)** (1–3 paragraphs of prose): how the area fits in the broader product. For role pages, the day-in-the-life. For feature areas, the mental model in one paragraph.
3. **Page index** (sub-section `## Pages in this section` or similar): bulleted list of links, each with a one-line description of what the page covers. The descriptions follow a parallel structure — same length, same shape.

**Pattern example.** [`platform/admin/overview.md`](../../docs/en/platform/admin/overview.md) is the canonical section overview.

**Common failures.**

- The body is the link list, with a sentence on top. Add 200–300 words of real prose framing.
- The page descriptions are inconsistent — some are full sentences, others are noun phrases. Pick one and be parallel.
- The links don't say _what's in_ the page, only the title. Rewrite each description.

### 5. Troubleshooting page

**Where they live.** `self-hosted/operate/observability/troubleshooting.md`, plus role-page troubleshooting sub-sections.

**What they do.** Map symptoms to fixes for the three or four issues the maintainer has actually seen. They are _not_ a comprehensive failure-mode catalogue.

**Shape.**

1. **Opening** (2–3 sentences): how the page is organised (symptom-first), how to diagnose anything not listed (logs, CLI verbose mode, GitHub issues link).
2. **Common issues** (each an `### Sub-heading` named for the symptom): one or two paragraphs each — symptom in concrete terms, root cause, fix. No troubleshooting tables — each issue earns its prose.
3. **Where to get help** (closing sub-section, named for the action): paragraph naming the support channels with contextualised links.

**Pattern example.** [`self-hosted/operate/observability/troubleshooting.md`](../../docs/en/self-hosted/operate/observability/troubleshooting.md).

**Common failures.**

- Every issue is one bullet line. Issues earn paragraphs — a symptom alone doesn't help the reader figure out which fix to try.
- "Other issues" catch-all section with a vague instruction. Cut it.

### 6. Integration / third-party guide

**Where they live.** `tutorials/admin/<integration>.md`, `develop/integrations.md`.

**What they do.** Walk a specific external pairing — Meetily, Microsoft 365, a local provider, etc. They are tutorials with an extra section on the boundary between Tale and the external system.

**Shape.** Tutorial shape (above), plus:

- A **Privacy notes** or **Trust boundary** sub-section before the closing that explicitly names what crosses the network in each direction and what doesn't. This is the most common reason a reader opens an integration guide; missing it fails the page.

**Pattern example.** [`tutorials/admin/meeting-transcription.md`](../../docs/en/tutorials/admin/meeting-transcription.md).

**Common failures.**

- No trust-boundary section. Add one.
- The integration's UI labels drift from the actual third-party UI. Verify against the current third-party version and add a "last verified" note in the commit message (not in the page — see Rule 5's no-status-chatter rule).

---

## Anti-patterns catalogue

Named failure modes. When a reviewer flags one, they can name it; when an agent reads this skill, they know what to avoid.

### Stub Closing

A closing section whose heading is `## Next` / `## See also` / `## Weiter` / `## Suite` and whose body is a bullet list of bare links. Caught by `closing-paragraph.test.ts`. Fix: rename the section for what it does, replace the bullet list with a recap paragraph and a contextualised link.

### Naked List

A sub-section whose body is _only_ a list — no prose paragraph above. The heading is doing a paragraph's job. Fix: write the paragraph first, then let the list follow.

### Abstract Noun Parade

A page that strings together abstract nouns ("posture", "journey", "story", "surface", "flow") instead of naming concrete things. Most common in section openings. Fix: replace each abstraction with the concrete noun it stood for (`our trust posture` → `our ISO 27001 and SOC 2 Type II certifications`).

### Heading Skeleton

A page whose sub-headings, read in order, narrate the page's logical structure — but whose body paragraphs don't deliver the _content_ the headings promise. The reader gets the table of contents and not much else. Fix: read each section in isolation, ask "what does the reader learn from this section?", rewrite to deliver that.

### Marketing Drift

Use of `simply`, `easy`, `powerful`, `seamless`, `discover`, `unleash`, `feel free to`, `it is recommended`, exclamation marks. Fix: strike. The thing's quality is demonstrated, not asserted.

### Translation Ghost

A translated page that reads correctly but feels like a translation — sentences track the English source clause-by-clause, idioms calque (`Trust posture` → `Vertrauenshaltung`), abstract English nouns get rendered literal. Fix: read aloud in the target language. If it sounds like a translation, restructure.

### Code Wall

A long sequence of code blocks with no prose between them. The reader can't follow what each block contributes. Fix: each code block earns one sentence before or after it naming what the block does and what changes after running it.

### Cross-Reference Salad

A page that links to seven other pages in three paragraphs, leaving the reader to triage. Fix: name the _one_ page that's most relevant for each junction; defer the rest to the closing's `## Where this fits`.

### Phantom Audience

A page that doesn't say who it's for, or addresses multiple audiences in one paragraph ("If you're an Admin, do X; if you're a Developer, do Y; if you're an Editor, do Z"). Fix: split into role-indexed pages that cross-link, or name the dominant audience in the opening and treat the others as edge cases.

### Stub Page

A whole page that would fit in a tweet — a sentence, a link list, a paragraph. Fix: merge it into its parent page or expand it. Stubs are worse than missing pages because the reader assumes there's nothing more to know.

### Bullet Avalanche

A page where bullet lines outnumber prose lines by 3:1 or more. The page is a slide deck, not a doc. Fix: convert each "bullet that's actually a sentence" back into a sentence.

### Status Chatter

`Updated:`, `New in v1.6:`, `Coming soon:`, `TODO:`, `Note that…`, `It should be noted that…`. Fix: delete. Release notes and git history cover the version-state question.

### Ghost Audience

The page assumes the reader is _also_ reading another page. References to "the page above" or "as we discussed earlier" without a link. Fix: every reference is a link with context.

### Half-Translated Sentence

DE/FR prose with English UI nouns spliced in: `Öffne **Settings > Members**`, `Téléverse dans la **Knowledge Base**`. Caught by `terminology.test.ts`. Fix: translate the noun to the shipped UI label.

### Pronoun Slip

DE prose using `Sie`, FR prose using `vous`. Caught by `terminology.test.ts`. Fix: rewrite to the informal form.

---

## Taxonomy

Docs are organised on two axes. The first axis is the top-level docs tab; the second axis applies only inside the Self-hosted tab, where readers split by platform role.

### Top-level tabs

| Directory      | Tab             | Audience                                                                                                                                         |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cloud/`       | **Cloud**       | Managed-SaaS readers. Onboarding, billing, data residency (Switzerland/EU), trust and compliance, Cloud-specific admin.                          |
| `self-hosted/` | **Self-hosted** | Operators running Tale on their own infrastructure, and end users of those instances, split by role.                                             |
| `platform/`    | **Platform**    | Product feature reference. Identical for Cloud and Self-hosted. **The single source of truth for every feature** — Cloud and role pages link in. |
| `develop/`     | **Develop**     | API consumers, webhook integrators, SDK users, source contributors.                                                                              |
| `legal/`       | (footer)        | Privacy policy, terms of service, DPA. `noindex: true` in frontmatter.                                                                           |

### Self-hosted sub-structure

Operators and end users share the tab. They live in different subdirectories so each role can be navigated in isolation.

| Subdirectory     | Audience                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `install/`       | First-time installation — Linux, Docker Compose, Kubernetes, TLS.                                   |
| `cli/`           | The `tale` CLI — commands, install, troubleshooting.                                                |
| `configuration/` | Environment variables, retention, providers, storage, networking. Authoritative reference pages.    |
| `operate/`       | Running a live instance — deployments, observability, backups, upgrades, advisories, release notes. |
| `admin/`         | Owner and Admin workflows — members, roles, teams, auth, branding, governance, usage analytics.     |
| `developer/`     | Developer-role tasks — agents, automations, integrations, API keys, webhooks.                       |
| `editor/`        | Editor-role tasks — knowledge base, conversations, approvals, products/customers/vendors.           |
| `member/`        | Member-role tasks — chat, read-only knowledge and conversations, preferences.                       |

### Placement rules

- **Feature reference goes under `platform/`.** One canonical page per feature. Cloud and role pages link in; they do not re-document.
- **Deployment-only content goes under its flavour tab.** Install docs only apply to Self-hosted; billing only applies to Cloud.
- **Role pages own the task, platform pages own the concept.** An Editor's how-to on uploading a document lives at `self-hosted/editor/knowledge-base.md`; the full walkthrough lives at `platform/workspace/knowledge-base.md`. Never copy the walkthrough into a role page — link to it.
- **`platform/` is the UI. System access lives under `self-hosted/`.** Anything a user — including admins — does inside the running app (click a button, fill in a form, toggle a setting in **Settings > …**) goes under `platform/`. Anything that requires filesystem access, config files (`TALE_CONFIG_DIR/**`), environment variables, CLI commands, SOPS, Docker, or server-side deployment goes under `self-hosted/configuration/` or `self-hosted/operate/`. When the same feature has both a UI path and a config-file path, `platform/` describes **only** the UI path and links to the self-hosted reference for the file form. Never paste a JSON config snippet, a `cp examples/... $TALE_CONFIG_DIR/...` command, or an env-var table into a `platform/` page — those contradict the Cloud reader's reality and belong one tab over.
- **Owner has no directory.** Owner is Admin plus a small set of org-lifecycle actions, which live in one page: `self-hosted/admin/organization-lifecycle.md`.
- **Disabled has no docs.** A Disabled account cannot access the product.
- **Cloud has no role split.** Cloud readers consume `platform/` directly; role permissions are covered by the shared canonical matrix at `self-hosted/admin/members-and-roles.md` (linked from Cloud admin pages).

Never mix audiences in one page. If a concept genuinely spans audiences, write two short pages that cross-link, not one hybrid page.

### Where things live (path quick reference)

| Path                                                 | Role                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/en/**/*.md`                                    | English pages. The source tree.                                                                                                                      |
| `docs/de/**/*.md`, `docs/fr/**/*.md`                 | Translated mirrors. Same tree shape as English.                                                                                                      |
| `docs/<xx-YY>/**/*.md`                               | Regional variant overrides (today `de-CH`). Sparse — only files that genuinely differ from the base. Missing files fall back to the base, then `en`. |
| [`docs/nav.json`](../../docs/nav.json)               | Navigation tree — sidebar order and group labels. Edited alongside every page addition/rename/deletion.                                              |
| [`services/docs/`](../../services/docs/)             | The docs service — Vite + React SSR app that prerenders the static site.                                                                             |
| [`services/docs/tests/`](../../services/docs/tests/) | Vitest checks: structural + prose + terminology.                                                                                                     |

The docs service builds straight from the committed repo state via `bun run --filter @tale/docs build` (search index, SSR, prerender, llms.txt, sitemap). If it is not in git at merge time, it does not exist on the site.

---

## Translation philosophy

Translation is its own craft. The terminology skill at [`.agents/terminology/AGENTS.md`](../terminology/AGENTS.md) is the authoritative source — read it before translating any page. What follows is the philosophy that governs every translation move; the per-locale tables and pattern catalogues live in the terminology files.

### Three layered rules

**1. Translate meaning, not words.** Sentence structure, idiom, and noun choice all differ across languages. A mechanical, word-for-word render produces sentences native readers reject — even when every individual word is correct. The German equivalent of an English three-clause sentence is often one longer sentence with a verb-final subordinate clause; the French equivalent of a stacked English noun phrase is often a relative clause. Write the _natural_ target-language sentence, not the calque.

**2. Same voice across locales.** The calm, opinionated narrator survives translation. The two drift modes the terminology skill catalogues — German passive bureaucracy (`Wird gespeichert…`, sentence-final `erfolgreich`) and French marketing softening (`Découvrez`, `N'hésitez pas à`) — are tone bugs, not just wording bugs. Fix the wording.

**3. Pragmatic loanwords.** English shows up in DE/FR for legitimate reasons (the term is the term in the industry) and for bad reasons (the translator gave up). The terminology skill defines three buckets: _Always English_ (brand names, acronyms, code identifiers), _Established loanwords_ (`Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Integration`, `Tool`), and _Translate (must)_ (`Header`, `Request`, `Provider`, `Email`, `Help Center`, `Billing`, `Sales Research`, `Draft`, `Attachment`, `Self-hosted`, plus FR-only `Engineering`). The third bucket is enforced by `loanword.test.ts`.

### UI labels must match the shipped string

Every user-facing term a doc page names matches the string the UI actually displays in that locale, verbatim. The source of truth is `services/platform/messages/<locale>.json`. If the German UI shows `Kunden` and your page writes `Customers`, the reader cannot find what you point at. Mixed forms (half English, half translated) in the same sentence are the most common bug.

Specific rules:

1. **`services/platform/messages/<locale>.json` is the single source of truth.** Terminology files document it; docs quote it. Before writing a UI term in a translated page, grep the locale JSON for its key. If the UI string and the terminology file disagree, the UI wins — update the terminology file to match, then the doc.
2. **Don't carry English as a loanword unless the UI itself does.** `Canvas` stays `Canvas` in German (UI shows `Canvas`) but becomes `Canevas` in French (UI shows `Canevas`).
3. **Code identifiers stay English.** CLI flags (`tale deploy --detach`), env vars (`TALE_CONFIG_DIR`), file paths (`docker-compose.yml`), i18n keys (`chat.canvas.title`), API paths (`POST /api/v1/documents`) are international.
4. **Role names stay English in EN, translate to the shipped UI form in DE/FR.** UI ships `Owner` / `Admin` / `Developer` / `Editor` / `Member` / `Disabled` in English; the German UI ships `Inhaber` / `Admin` / `Entwickler` / `Redakteur` / `Mitglied` / `Deaktiviert`; the French UI ships `Propriétaire` / `Admin` / `Développeur` / `Éditeur` / `Membre` / `Désactivé`. Docs follow the shipped UI per locale.
5. **Parenthetical lists translate too.** When an English page writes `(Products, Customers, Vendors)` as examples, the German mirror writes `(Produkte, Kunden, Lieferanten)`. Don't leave the English list behind — it contradicts the UI the reader just opened.
6. **Navigation paths translate segment by segment.** `Settings > Members` becomes `Einstellungen > Mitglieder` / `Paramètres > Membres`. Writing `Einstellungen > Members` is a bug: the reader sees `Einstellungen` in the sidebar but no `Members` entry.

Worked examples and the canonical per-locale UI label table live in [`.agents/terminology/`](../terminology/). Read them.

### Lifecycle rules

When you **add** a page:

1. Create the English file at `docs/en/<path>.md`.
2. Create translated mirrors at `docs/de/<path>.md` and `docs/fr/<path>.md`.
3. Add the page slug to [`docs/nav.json`](../../docs/nav.json) under the right group. The same slug serves every locale; the loader resolves it per language.
4. Run `bun run --filter @tale/docs format` to normalise Markdown.
5. Commit the locale files and `nav.json` together.

When you **rename or move** a page:

1. Rename the file in every locale tree.
2. Update the slug in [`docs/nav.json`](../../docs/nav.json).
3. Grep the repo for the old path (at minimum [`README.md`](../../README.md) and the sibling locales) and update references.

When you **delete** a page:

1. Delete from every locale tree.
2. Remove the slug from [`docs/nav.json`](../../docs/nav.json).

### Editing rules

- **Locale-prefixed internal links** in non-English files. A link in `docs/de/platform/agents/create.md` points to `/de/platform/agents/concepts`, not `/platform/agents/concepts`.
- **Translate every frontmatter value.** Both `title` and `description`. A German page with an English title is a bug.
- **Code and diagram syntax stays put.** Inside fenced code, `<CodeGroup>`, and Mermaid DSL, translate only human-readable node labels. Never the arrows, `participant` keywords, or block structure.
- **Brand names never translate.** Tale, Convex, OpenRouter, Claude, GitHub, Slack, Gmail, Outlook, Shopify — all stay as-is in every locale.
- **Keep anchors stable.** Headings are slugged by the markdown renderer; when you change a heading in one locale, update every locale that links to the anchor, since the generated slug differs per locale.
- **Maintain heading-outline parity.** [`services/docs/tests/locale-parity.test.ts`](../../services/docs/tests/locale-parity.test.ts) requires that DE and FR mirrors have the same heading levels and same fenced-code-block count as their English source. Restructuring the EN page means restructuring DE and FR in the same PR.

---

## Mechanics

Frontmatter, filenames, headings, tables, diagrams. The easy parts, applied uniformly.

### Frontmatter

Required on every page:

```yaml
---
title: Sentence-case page title
description: One sentence completing "This page is about…". Used by search; keep it specific.
---
```

Optional fields:

- `noindex: true` — for legal pages, drafts, and anything that should not appear in search.
- `kind: index` — for locale-root landing pages exempt from the opening-paragraph rule.

### Filenames

Dash-case, lowercase. `api-reference.md`, never `api_reference.md` or `APIReference.md`. Filenames map to URL slugs verbatim — once a page is published, renaming it breaks every inbound link.

### Headings

- **Sentence case** in every locale. `## Agent concepts`, not `## Agent Concepts`. `## Concepts des agents`, not `## Concepts des Agents`.
- **Named for what the section does.** `## Build one` beats `## Building`.
- **H1 is the page title from frontmatter** and is rendered by the docs theme — never write `# X` in the body.
- **Maximum H4.** If you need H5, the page should be split.

### Code blocks

- **Always carry a language identifier.** ` ```bash `, ` ```typescript `, ` ```json ` — never a bare ` ``` `. The renderer's syntax highlighter is keyed on the identifier.
- **Lead with their effect.** Either a sentence before the block names what the block does, or the block ends with one or two sentences naming what changed. Naked code with no surrounding prose is a Code Wall anti-pattern.
- **Comments inside code are part of the code.** Don't translate them.
- **CLI examples use `$` for command lines that show output**; bare commands are shown without `$` when the output is omitted.

### Tables

- **Aligned pipes.** Run `bun run --filter @tale/docs format` (oxfmt) before committing. Reviewers read tables in editors, not just rendered.
- **Sentence case in cells.** No row says `Add a new agent` capitalised differently from the next.
- **Parallel structure in columns.** Every row in a "field / purpose" table has the same shape; don't switch from imperative to noun-phrase between rows.

### Lists

- **Bullet lists for unordered sets of five or more parallel items.** Fewer than five — write the sentence.
- **Numbered lists only when order matters.** A list of steps is numbered; a list of options is bulleted.
- **Parallel grammatical structure.** All bullets start with a verb, or all with a noun. Don't mix.

### Mermaid diagrams

- **Use Mermaid for architecture and flow diagrams.** Tale's docs theme renders Mermaid natively.
- **Label nodes in full sentences or short noun phrases.** Translate node labels per locale; leave arrows and keywords (`participant`, `-->`, etc.) untouched.
- **Size for one screen.** A diagram that scrolls is two diagrams.
- **One Mermaid block per concept.** Don't pack two unrelated flows into one diagram.

### Cross-references and link anchor text

- **Anchor text describes the destination.** `See [Agent concepts](/platform/agents/concepts)` — never `click here`, `this link`, `more info`.
- **Inline links** for cross-references that interrupt the sentence's flow with a useful destination.
- **End-of-section linked closing paragraph** for "for more, see…" — the page-shape rule already requires it; don't double up.

---

## Workflow

### Local preview

```bash
bun install                          # first time only
bun run --filter @tale/docs dev      # builds search index + llms artifacts, then starts the Vite dev server
```

Click through the language switcher on every section on every locale. A 404 in any locale means a missing file or a stale [`docs/nav.json`](../../docs/nav.json) entry.

### Before every PR

All four must pass:

```bash
bun run --filter @tale/docs format    # oxfmt: normalise Markdown and JSON
bun run --filter @tale/docs lint      # oxlint
bun run --filter @tale/docs test      # structural + prose + terminology
bun run --filter @tale/docs build     # search index, prerender, llms.txt, sitemap, robots.txt
```

The `test` step covers structural parity (every nav slug resolves, every page has frontmatter, DE/FR mirrors keep the EN outline) _and_ prose checks (opening has ≥ 2 sentences before any heading or list; closing is not a stub; translate-bucket loanwords don't appear in DE/FR prose). Inspect [`services/docs/tests/`](../../services/docs/tests/) for the exact rules.

### What to fix first when a test fails

1. **Navigation parity** — every slug resolves. Blocks everything else; fix first.
2. **Frontmatter** — every page has `title` and `description`. Two-second fix per page.
3. **Locale parity** — DE/FR mirror the EN outline. If you restructured the EN page, mirror the restructure in DE+FR before committing.
4. **Terminology / formal pronouns / loanwords** — language-specific. Use the per-locale terminology files.
5. **Opening / closing paragraphs** — usually the deepest fix. Rewrite to the page-shape contract.

---

## Common pitfalls (the cheat sheet)

- **Forgetting [`docs/nav.json`](../../docs/nav.json).** A file on disk but not in the nav is invisible in the sidebar.
- **Translated anchors that don't match their target.** `/de/foo#some-heading` only works if `docs/de/foo.md` has a heading whose German slug is `some-heading`.
- **External links cast as internal.** `](/external-site)` is treated as in-site and 404s. External links are fully qualified (`https://…`).
- **Committing without running `format`.** Run it first so reviewers don't wade through alignment or whitespace noise.
- **Duplicating env var or API reference content.** The reference pages are authoritative — link to them.
- **Page opens with one sentence and a list.** `opening-paragraph.test.ts` blocks the PR. Rewrite to 2–4 sentences with the _why_ present.
- **Page closes with `## Next` and a single link.** `closing-paragraph.test.ts` blocks the PR. Rename the closing section, recap in one paragraph, link with context.
- **DE / FR page leaves a translate-bucket English noun in prose.** `loanword.test.ts` blocks the PR. Use the native term from the terminology table.
- **DE / FR uses `Sie` / `vous`.** `terminology.test.ts` blocks the PR. Rewrite to informal.

---

## Quick reference — the page shape contract

| Surface     | Rule                                                                                                              | Test                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Opening     | 2–4 sentences of prose, with _what / who / why_                                                                   | `opening-paragraph.test.ts`                                        |
| Body        | Prose first, lists for 5+ parallel items, every heading owns a paragraph                                          | review                                                             |
| Closing     | Named for what it does (`## Build one`, `## Where this fits`, …), recap paragraph, contextualised link            | `closing-paragraph.test.ts`                                        |
| Voice       | Second person informal, why before what, no marketing softening                                                   | review                                                             |
| Translation | UI labels match shipped strings; translate-bucket nouns are translated; informal pronoun; same EN heading outline | `terminology.test.ts`, `loanword.test.ts`, `locale-parity.test.ts` |
| Mechanics   | Frontmatter `title` + `description`, dash-case files, sentence-case headings, language ID on code blocks          | `frontmatter.test.ts`                                              |
