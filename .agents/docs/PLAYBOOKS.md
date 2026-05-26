# Page-type playbooks

Six page types cover everything in `docs/`. Each has a shape contract on top of the universal opening/body/closing rules from [AGENTS.md](AGENTS.md).

## 1. Concept page

**Where they live.** `platform/<area>/<topic>.md` for product concepts; `develop/<topic>.md` for developer concepts.

**What they do.** Hand the reader the mental model — the vocabulary, the relationships, the trade-offs. A concept page is what someone reads _before_ they touch the UI, not while they're using it.

**Shape.**

1. **Opening** (3–4 sentences) — name the concept, who uses it, what it solves that the next-closest concept doesn't.
2. **The pieces** — one sub-section per piece. Each opens with a paragraph naming what the piece controls and the consequence of the typical choice; lists or tables follow.
3. **Putting it together** — one or two worked combinations of the pieces.
4. **When to reach for it** _(required when the concept has sibling features)_ — a decision table comparing this concept to its closest siblings. Columns: `Use … when | …`.
5. **Closing** named `## Build one`, `## Where this fits`, or `## When to reach for it`.

**Pattern example.** [`platform/agents/concepts.md`](../../docs/en/platform/agents/concepts.md) — four pieces (instructions, knowledge, tools, model), one combination table, `## Build one` closing.

**Common failures.**

- The opening defines the concept by listing its sub-headings. Define by what it _does_, not what it contains.
- A piece sub-section is one sentence and a bullet. Add the prose paragraph; the bullets follow.
- No "When to reach for it" table on a concept with obvious siblings. Readers leave without knowing whether they're on the right page.
- Closing is `## Next`. Rename it.

## 2. Tutorial

**Where they live.** `tutorials/<role>/<task>.md`.

**What they do.** Take the reader from "I want to do X" to a working result, end to end, on a fresh instance.

**Shape.**

1. **Opening** — outcome, prerequisites in one sentence, reference link for the underlying feature.
2. **What you'll build** _(optional)_ — a paragraph plus a diagram if the workflow has more than three steps.
3. **Before you begin** — prose-led bullets naming each prerequisite and how to verify it (`Editor or higher`, `Cloud or Self-hosted`, feature flag, external account, API key).
4. **Numbered steps** (`## Step 1 — <action>`) — each step is one move (one thing created, configured, or run). Each starts with a paragraph naming the consequence + why, walks the mechanic, then names the verification — how the reader knows the step worked.
5. **Troubleshooting** — three or four issues you have actually seen. Symptom → cause → fix.
6. **Closing** named `## Where this fits` or `## Where this gets used`.

**Pattern example.** [`tutorials/editor/first-agent-end-to-end.md`](../../docs/en/tutorials/editor/first-agent-end-to-end.md).

**Common failures.**

- Steps that are "Open Settings > Members" with no surrounding prose. Add the paragraph naming what the reader is configuring and why.
- A step that does three things at once. Split.
- No verification — the reader can't tell whether step 3 actually worked. Add the sentence.
- Closing is "Run it!" or a bare link. Recap, then connect.

## 3. Reference page

**Where they live.** `platform/<area>/<feature>.md`, `develop/api-reference.md`, `self-hosted/configuration/<topic>.md`.

**What they do.** Be the single source of truth for a feature, an API surface, a config file, or an env-var inventory. Consulted _during_ a task, often via search.

**Shape.**

1. **Opening** (2–3 sentences) — name the feature, audience, canonical scope ("this page covers X, not Y — Y lives at <link>").
2. **A worked example** — the first body sub-section. A request + response for an API. A working config snippet for a knob. One fully populated instance for a schema.
3. **The data** — sub-sections for sub-concepts. Parameter and option tables use the fixed `Name | Type | Required | Description` shape (or `Name | Default | Description` for env vars).
4. **Edge cases / advanced** _(optional)_.
5. **Closing** named `## Where this fits`.

**Pattern example.** [`self-hosted/configuration/providers.md`](../../docs/en/self-hosted/configuration/providers.md).

**Common failures.**

- The opening is one sentence of definition. Add the scope sentence.
- The page leads with the options table, example buried at the bottom. Move the example up.
- Parameter tables drift from the fixed column shape.
- Tables with no prose introduction.

## 4. Section overview

**Where they live.** `<area>/index.md`, `<area>/overview.md`.

**What they do.** Frame the area for someone who landed on the section root.

**Shape.**

1. **Opening** (3–4 sentences) — name the area, audience, why it exists. For role-indexed overviews, what this role can do that the next-closest role can't.
2. **Context paragraphs** (1–3) — how the area fits in the broader product.
3. **Page index** (`## Pages in this section`) — `**[Page title](/locale/path)** — one sentence naming the audience and the outcome of reading it.` Same length, same grammar, every row.

**Pattern example.** [`platform/admin/overview.md`](../../docs/en/platform/admin/overview.md).

**Common failures.**

- Body is the link list, with a sentence on top. Add 200–300 words of real prose framing.
- Inconsistent page descriptions — some full sentences, others noun phrases.
- Descriptions name the topic but not the outcome.

## 5. Troubleshooting

**Where they live.** `self-hosted/operate/observability/troubleshooting.md`, plus role-page troubleshooting sub-sections.

**What they do.** Map symptoms to fixes for the three or four issues the maintainer has actually seen. _Not_ a comprehensive failure-mode catalogue.

**Shape.**

1. **Opening** — how the page is organised (symptom-first), how to diagnose anything not listed.
2. **Common issues** — each `### Sub-heading` named for the symptom; one or two paragraphs (symptom → cause → fix).
3. **Where to get help** — support channels with contextual links.

**Common failures.**

- Every issue is one bullet line. Issues earn paragraphs.
- "Other issues" catch-all section with a vague instruction. Cut it.

## 6. Integration guide

**Where they live.** `tutorials/admin/<integration>.md`, `develop/integrations.md`.

**What they do.** Walk a specific external pairing — Meetily, Microsoft 365, a local provider, etc.

**Shape.** Tutorial shape plus a **Privacy notes** or **Trust boundary** sub-section before the closing that names what crosses the network in each direction and what doesn't.

**Pattern example.** [`tutorials/admin/meeting-transcription.md`](../../docs/en/tutorials/admin/meeting-transcription.md).

**Common failures.**

- No trust-boundary section. Add one.
- The integration's UI labels drift from the third-party reality.

## 7. Glossary / reference table

**Where they live.** `self-hosted/configuration/environment-reference.md`, glossary-style pages, exhaustive enum listings.

**What they do.** Be the searchable, alphabetically-or-categorically-sorted source of truth for a closed set.

**Shape.**

1. **Opening** (2–3 sentences) — name the set, who reads it, when.
2. **How to read this page** _(optional)_ — ordering, source of truth, how to search.
3. **The tables** — one sub-section per logical group; each opens with one to two sentences naming what the group controls.
4. **Closing** named `## Where this fits`.

**Common failures.**

- Page is one giant table with no grouping.
- Row descriptions are noun phrases.
- Page tries to be a tutorial too — split.
