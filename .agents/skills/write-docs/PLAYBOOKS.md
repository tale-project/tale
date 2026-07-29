# Page-type playbooks

Seven page types cover a docs tree. Each is a shape contract on top of the universal rules in
[SKILL.md](SKILL.md): a real opening (≥2 sentences: what / who / why), a body built for the
reader's task, and a named closing that recaps and hands off. The repo's docs guide names a
pattern page for each type where one exists — read it before writing your first page of that type.

## 1. Journey page

**What it does.** Takes the reader from "I want to do X" to a working, verified result, end to
end. Tutorials, quickstarts, get-started paths, and connector guides are all journeys.

**Shape.**

1. **Opening** — the outcome the reader will have, who this is for, rough time to complete.
2. **End-state visual** _(when the result is visible)_ — a framed screenshot or diagram of what
   "done" looks like, so the reader can calibrate before investing.
3. **Before you begin** — prose-led prerequisites, each with how to verify it (role, edition,
   external account, running instance).
4. **The journey** — `<Steps>` for short journeys, `## Step N — <action>` headings for long ones
   (the rule is in [COMPONENTS.md](COMPONENTS.md)). Every step: one move, opened with its
   consequence + why, walked effect → location → action, **visualized when it touches the UI**,
   closed with its verification — how the reader knows it worked (a check callout where available).
5. **Troubleshooting** _(optional)_ — the three or four failures you have actually seen:
   symptom → cause → fix.
6. **Closing** — what exists now and why it matters, then a fan-out (cards or contextual links)
   to the next journey and the reference pages that deepen it.

**Connector-guide variant.** Add a **trust boundary** section before the closing naming what
crosses the network in each direction and what doesn't.

**Common failures.** A step that does three things (split it); a step with no verification; a UI
step with no screenshot; prerequisites the reader can't check; a closing that says "Run it!" over
a bare link.

## 2. Feature page

**What it does.** The single source of truth for one product surface — read while using it.
This is the workhorse of a product docs tree.

**Shape.**

1. **Opening** (2–4 sentences) — what the feature is, who reaches for it, what it solves that the
   nearest sibling doesn't.
2. **Hero shot** — a framed screenshot of the feature's main surface, captioned with what the
   reader is looking at. The reader should recognize the screen they have open.
3. **The jobs** — one section per thing the reader does with it, each named for the outcome,
   prose-led, with a detail screenshot where the state is visual. Gotchas ride as callouts, not
   buried mid-paragraph.
4. **When to reach for it** _(required when siblings exist)_ — a decision table:
   `Use <this> when… | Use <sibling> when…`.
5. **Closing** — recap the load-bearing idea, connect to the sibling pages.

**Word budget.** Roughly 350–500 words of prose — the removed words become screenshots and
callouts, not lost content.

**Common failures.** No hero shot; sections named for UI containers ("The dialog") instead of
jobs; a config-file snippet on a UI page when the repo separates UI docs from operator docs;
gotchas buried in paragraph three.

## 3. Concept page

**What it does.** Hands the reader the mental model — vocabulary, relationships, trade-offs —
read _before_ touching the UI, not during.

**Shape.**

1. **Opening** (3–4 sentences) — the concept, who needs it, what it explains that the
   next-closest concept doesn't.
2. **The pieces** — one sub-section per piece; each opens with what the piece controls and the
   consequence of the typical choice.
3. **A diagram** — expected when the concept has three or more interacting pieces; one concept
   per diagram.
4. **Putting it together** — one or two worked combinations.
5. **When to reach for it** _(required with siblings)_ — the decision table.
6. **Closing** — named for the natural next act (`## Build one`, `## Where this fits`).

**Common failures.** Defining the concept by listing its sub-headings; a piece that is one
sentence and a bullet; screenshots where a diagram carries the relationships better.

## 4. Reference page

**What it does.** The searchable source of truth for an API surface, a config file, an option
inventory. Consulted mid-task.

**Shape.**

1. **Opening** (2–3 sentences) — the surface, the audience, the canonical scope ("this covers X,
   not Y — Y lives at <link>").
2. **A worked example first** — a real request and its real response, a working config, one fully
   populated instance. The same operation in multiple languages goes in a code group; the same
   task in mutually exclusive contexts (OS, edition) goes in tabs.
3. **The data** — one sub-section per sub-concept; parameter tables keep one fixed column shape
   throughout (`Name | Type | Required | Description`, or `Name | Default | Description` for
   environment variables).
4. **Edge cases / advanced** _(optional)_ — destructive or irreversible behaviour carries a
   warning callout.
5. **Closing** — `## Where this fits`.

**Common failures.** Options table first, example buried; drifting table shapes; tables with no
prose introduction; screenshots of things that are text.

## 5. Section overview

**What it does.** Frames an area for someone who landed on the section root, then routes them.

**Shape.**

1. **Opening** (3–4 sentences) — the area, its audience, why it exists. For role-indexed
   overviews: what this role can do that the next-closest can't.
2. **Context** (1–3 paragraphs) — how the area fits the broader product. Real framing, not filler.
3. **The routes** — a card group, one card per page: title = the page, body = one sentence naming
   the audience and the outcome of reading it, parallel grammar across cards.
4. **Closing** — a real recap paragraph; overviews are pages, not menus.

**Common failures.** A sentence and a link list; card descriptions that name the topic but not
the outcome; mixed grammar across cards.

## 6. Troubleshooting page

**What it does.** Maps symptoms to fixes for the issues the maintainer has actually seen — not a
comprehensive failure catalogue.

**Shape.**

1. **Opening** — how the page is organized (symptom-first) and how to diagnose anything not
   listed.
2. **The issues** — one `###` heading per symptom, named for what the reader sees, one or two
   paragraphs each: symptom → cause → fix. Headings, not accordions — troubleshooting is searched.
3. **Where to get help** — support channels with context.

**Common failures.** One-bullet issues; an "Other issues" catch-all; accordion-hiding the
symptoms search needs to find.

## 7. Glossary / reference table

**What it does.** The sorted, searchable source of truth for a closed set (environment variables,
enums, terms).

**Shape.**

1. **Opening** (2–3 sentences) — the set, who reads it, when.
2. **How to read this page** _(optional)_ — ordering, source of truth, how to search.
3. **The tables** — one sub-section per logical group, each introduced by one or two sentences
   naming what the group controls.
4. **Closing** — `## Where this fits`.

**Common failures.** One giant ungrouped table; noun-phrase row descriptions; a glossary that
tries to be a tutorial (split it).

## Choosing the type

Ask what the reader is doing when they land: **doing something for the first time** → journey;
**using a surface right now** → feature page; **deciding or understanding** → concept;
**looking something up** → reference or glossary; **lost at a section root** → overview;
**something is broken** → troubleshooting. A page serving two of these at once serves neither —
split it and cross-link.
