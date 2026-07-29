---
name: write-docs
description: Use this skill whenever you write or edit end-user documentation — a page under a docs content tree, a docs navigation or sidebar file, a docs landing or overview page, a screenshot or code example embedded in docs, or a failing docs structural check. It owns the journey-first method — organize every page around what the reader is trying to do, show the UI before describing it, prove behaviour with runnable examples, and use the docs component vocabulary (steps, tabs, code groups, callouts, frames, cards) with discipline instead of walls of prose. Before writing anything, discover the repo's own docs contract — its docs guide, its component registry, its structural test suite — and let that contract override this skill's defaults. Never write a docs page from imagination, never describe a UI you have not driven, and never ship a hand-captured screenshot. Page-type playbooks, component rules, screenshot doctrine, worked examples, and mechanics live in companion files here.
---

# write-docs

A docs page exists to move a reader from an intent — "I want X" — to a verified outcome, and the
docs read as **one narrator**: a calm, opinionated peer who shipped a similar product and is telling
a capable stranger how this one works — not selling, not hand-holding, not spec-dumping. This skill
owns the method for the source language; cross-locale authoring (translated labels, per-locale
grammar) follows the repo's translation skill or conventions where present.

## When this applies

Creating or editing any page in the repo's docs content tree, editing its navigation/sidebar config,
adding or regenerating a docs screenshot or code example, reshaping a landing or overview page, or
triaging a failing docs structural check.

## Discover the repo's contract first

Before the first edit, locate — in this order — and read what exists:

1. **The docs content tree** and its locale layout (which languages ship, which is the source).
2. **The docs guide nearest the content** (`AGENTS.md`, `README`, `CONTRIBUTING`) — it names the
   commands, the taxonomy, and the repo facts this skill deliberately does not carry.
3. **The component registry the renderer actually supports** — never author a tag the renderer
   doesn't register; an unregistered tag renders as broken text.
4. **The structural test suite that gates docs** (and how to run it) — its rules are the floor.
5. **The product's message catalogs** — UI labels in docs match the shipped strings
   character-for-character.

The repo's tests and guide are the contract; this skill's rules are the defaults that apply where
the repo is silent.

## Write a note first

**Write a short planning note** and record your answers to this form before you write the page:

- **Journey & audience:** Describe what the reader is trying to do when they land here, who they
  are, and which page type (playbook) fits.
- **Verified claims:** Describe which labels, defaults, routes, or limits you checked against the
  running product or its source — and what surprised you.
- **Visuals & code plan:** Describe which journey steps get a screenshot and which claims get
  runnable examples.
- **Ripple:** Describe which locales, nav entries, images, and sibling pages this touches.

## The doctrine

Four rules fail review; each carries its why.

1. **Journey-first.** Pages are organized around what the reader is trying to do, not around the
   feature's internal structure. Every section heading names an outcome or a decision; the page's
   opening answers what the reader will have when they're done. A page that can't name its reader's
   task is a reference page — shape it as one deliberately ([PLAYBOOKS.md](PLAYBOOKS.md)).
2. **Show, then tell.** Every UI step the reader must perform is visualized — a screenshot in a
   frame with a caption — before or beside the prose that describes it. A UI walkthrough with zero
   screenshots fails review; so does a hand-captured one: every image is reproducible through the
   repo's capture pipeline ([SCREENSHOTS.md](SCREENSHOTS.md)).
3. **Prove with code.** Any claim a reader will act on programmatically ships as a runnable
   example — a real request and its real response, a real command and its real output — never a
   paraphrase. One verified example beats three paragraphs of description.
4. **Truth over polish.** Every label, default, route, limit, and behaviour is verified against the
   shipped product before the page is done. Drive the UI you describe; run the code you quote.
   Voice covers how it reads; this covers whether it's true.

## The voice — see it first

| Version          | Sample                                                                                                                                                                          | Why it fails                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Marketing soft   | Simply click **Save** and you're all set! Feel free to add as many providers as you like.                                                                                       | "Simply", "all set", "Feel free to", `!`. |
| First-person we  | We recommend you click **Save** after configuring each provider, since we sync them in the background.                                                                          | "we", missing why.                        |
| Imperative naked | Click **Save**.                                                                                                                                                                 | No why — what does Save _do_ here?        |
| **The voice**    | Click **Save**. The new provider is reachable from agents on the next request — there's no separate rollout step, and existing conversations keep their previous model binding. | Imperative, why present, no fluff.        |

Three guardrails the voice always holds:

- **Second person, informal** where the language distinguishes — never "we", never "the user".
- **Imperative for instructions** — `Run the command`, never `You can run…`, never `Please run…`.
- **Why before what** — name the consequence (what it does, what breaks if you skip it), then the
  step. Walkthroughs go _effect → location → action_: "To add a person, open **Settings >
  Members** and click **Invite member**", never a click-trail with the purpose at the end.

Strike on sight: `simply`, `easy`, `just`, `seamless`, exclamation marks in prose, "we".

## Components with discipline

Prose is still the default. A component earns its place only when it beats the plain-markdown
rendering of the same content — the full per-component rules are [COMPONENTS.md](COMPONENTS.md).
Two failure directions, equally fatal: the **wall of text** (a UI journey with zero visuals or
structure) and **component soup** (a page that's all boxes — stacked callouts, tabs hiding required
reading, steps wrapping non-sequences).

## Locales ship together

Where the docs tree is localized, every locale updates in the same change, mirrors the source
page's structure (headings, fences, components), and is authored natively in the shared voice —
never a word-for-word rendering. Code, filenames, and brand names stay identical across locales;
prose, frontmatter, alt text, and captions translate. Follow the repo's translation skill where
present.

## Before you call the page done

**Tick every box, or N/A with a reason — an unticked box means not done:**

- [ ] **Repo contract discovered and obeyed** — docs guide read, component registry checked, test
      suite located.
- [ ] **The journey is named** — the note says what the reader is trying to do and which playbook
      shape the page uses.
- [ ] **Real opening and closing** — ≥2 sentences answering what/who/why before anything else; a
      named closing that recaps and hands off, not a `## Next` stub.
- [ ] **Every UI step visualized** — or N/A: the page describes no UI. No hand-captured images;
      every screenshot regenerable from the repo's capture pipeline.
- [ ] **Every code example executed** — the output shown is the output you observed.
- [ ] **Every component justified** — it beats the plain-markdown alternative
      ([COMPONENTS.md](COMPONENTS.md)).
- [ ] **Every UI label verified** against the shipped strings, in every locale the docs ship.
- [ ] **Every locale updated** in the same change, natively authored.
- [ ] **The repo's docs test suite is green**, and the page was viewed rendered in the real docs
      app — every screenshot legible at content width.

## Companion files

- [PLAYBOOKS.md](PLAYBOOKS.md) — read when you know the page type (journey, feature, reference,
  overview, …) and want its shape contract + common failures.
- [COMPONENTS.md](COMPONENTS.md) — read before reaching for steps, tabs, code groups, callouts,
  frames, cards, or accordions.
- [SCREENSHOTS.md](SCREENSHOTS.md) — read before adding, regenerating, or reviewing any image.
- [EXAMPLES.md](EXAMPLES.md) — read when writing an opening, closing, walkthrough, or a
  text-heavy→journey transformation and you want to see what passing looks like.
- [MECHANICS.md](MECHANICS.md) — read for frontmatter, filenames, headings, code blocks, tables,
  lists, diagrams, and links.
