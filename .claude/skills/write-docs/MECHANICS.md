# Mechanics

Frontmatter, filenames, headings, code blocks, tables, lists, diagrams, links. The bookkeeping
parts, applied uniformly. Repo-specific fields, commands, and opt-outs live in the repo's docs
guide — check it first; these are the defaults.

## Frontmatter

Required on every page:

```yaml
---
title: Sentence-case page title
description: One sentence completing "This page is about…". Used by search; keep it specific.
---
```

The repo may define opt-out fields (search exclusion, landing-page exemptions, per-page check
opt-outs) — use them sparingly, each with a reason, and only after reading the repo's docs guide.

## Filenames

Dash-case, lowercase. `api-reference.md`, never `api_reference.md` or `APIReference.md`. Filenames
usually map to URL slugs verbatim — renaming a published page breaks every inbound link; check the
repo's redirect mechanism before moving one.

## Headings

- **Sentence case** in every locale.
- **Named for the outcome or decision**, not the container. `## Build one` beats `## Building`;
  `## Invite your team` beats `## The members dialog`.
- **H1 is the page title from frontmatter** — never write `# X` in the body when the site renders
  the title.
- **Maximum H4.** If you need H5, split the page.

## Code blocks

- **Always carry a language identifier** — never a bare fence.
- **Lead with their effect.** A sentence before the block names what it does, or the block ends
  with one naming what changed. Naked code with no surrounding prose is the code-wall
  anti-pattern.
- **The output shown is the output you observed** — run the command, capture its real output.
- **Comments inside code are part of the code** — never translated.
- **Filename or label metadata on the fence** where the repo's renderer supports it — a labelled
  block reads as a file, not a fragment.

## Tables

- **Sentence case in cells**, parallel structure in columns — every row the same grammatical
  shape.
- **One fixed column shape per page** for parameter tables.
- **A prose sentence introduces every table** — what the set is, how to read it.

## Lists

- **Bullets for unordered sets of five or more parallel items** — fewer, write the sentence.
- **Numbers only when order matters.**
- **Parallel grammar** — all bullets start with a verb, or all with a noun; don't mix.

## Diagrams

- **Flow and architecture go in the repo's diagram syntax** (commonly Mermaid) — one concept per
  diagram, sized for one screen.
- **Node labels translate per locale; syntax and arrows don't.**

## Links and anchors

- **Anchor text describes the destination** — never `click here`, `this link`, `more info`.
- **Internal links carry the locale prefix** in non-source-locale files where the repo's routing
  localizes URLs.
- **External links are fully qualified** (`https://…`) — a path-style link to an external site is
  treated as in-site and 404s.
- **Heading anchors differ per locale** — a translated heading has a translated slug; verify the
  rendered anchor, don't assume the source-locale one.

## What stays constant across locales

Code, diagram syntax, brand and product names, filenames. Translation lives in frontmatter, body
prose, alt text, captions, and diagram node labels — never in slugs or code.
