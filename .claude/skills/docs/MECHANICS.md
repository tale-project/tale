# Mechanics

Frontmatter, filenames, headings, code blocks, tables, lists, Mermaid, links. The bookkeeping parts, applied uniformly.

## Frontmatter

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
- `noCurrencyCheck: true` — for pages that legitimately reference multiple currencies (Cloud billing).
- `noEmDashCheck: true` — for pages whose dash convention legitimately differs.
- `i18nLintExclude: ["check-id-a", "check-id-b"]` — per-page check opt-out. Use sparingly with a comment.

## Filenames

Dash-case, lowercase. `api-reference.md`, never `api_reference.md` or `APIReference.md`. Filenames map to URL slugs verbatim — renaming a published page breaks every inbound link.

## Headings

- **Sentence case** in every locale. `## Agent concepts`, not `## Agent Concepts`. `## Concepts des agents`, not `## Concepts des Agents`.
- **Named for what the section does.** `## Build one` beats `## Building`.
- **H1 is the page title from frontmatter** and is rendered by the docs theme — never write `# X` in the body.
- **Maximum H4.** If you need H5, split the page.

## Code blocks

- **Always carry a language identifier.** ` ```bash `, ` ```typescript `, ` ```json ` — never bare ` ``` `.
- **Lead with their effect.** Either a sentence before the block names what the block does, or the block ends with one or two sentences naming what changed. Naked code with no surrounding prose is a Code Wall anti-pattern.
- **Comments inside code are part of the code.** Don't translate them.
- **CLI examples use `$` for command lines that show output**; bare commands appear without `$` when the output is omitted.

## Tables

- **Aligned pipes.** Run the repo-wide `oxfmt` (`bun run format`, or let the edit hook do it) before committing — `services/docs` has no per-package `format` script.
- **Sentence case in cells.** No row says `Add a new agent` capitalised differently from the next.
- **Parallel structure in columns.** Every row in a "field / purpose" table has the same shape; don't switch from imperative to noun-phrase between rows.

## Lists

- **Bullet lists for unordered sets of five or more parallel items.** Fewer than five — write the sentence.
- **Numbered lists only when order matters.** A list of steps is numbered; a list of options is bulleted.
- **Parallel grammatical structure.** All bullets start with a verb, or all with a noun. Don't mix.

## Mermaid diagrams

- **Use Mermaid for architecture and flow diagrams.** The docs theme renders Mermaid natively.
- **Label nodes in full sentences or short noun phrases.** Translate node labels per locale; leave arrows and keywords (`participant`, `-->`) untouched.
- **Size for one screen.** A diagram that scrolls is two diagrams.
- **One Mermaid block per concept.** Don't pack two unrelated flows into one diagram.

## Links and anchors

- **Anchor text describes the destination.** `See [Agent concepts](/platform/agents/concepts)` — never `click here`, `this link`, `more info`.
- **Locale-prefixed internal links** in non-English files. A link in `docs/de/platform/agents/create.md` points to `/de/platform/agents/concepts`, not `/platform/agents/concepts`.
- **External links are fully qualified** (`https://…`). A `(/external-site)` link is treated as in-site and 404s.
- **Inline links** for cross-references that interrupt the sentence's flow with a useful destination.
- **End-of-section linked closing paragraph** for "for more, see…" — the page-shape rule already requires it; don't double up.

## What stays the same across locales

- Code and diagram syntax — translate node labels only, never arrows or `participant` keywords.
- Brand names — `Tale`, `Convex`, `OpenRouter`, `Claude`, `GitHub`, `Slack`, `Gmail`, `Outlook`, `Shopify` — never translate.
- Filenames — they're URL slugs. Translation lives in `title` / `description` frontmatter and in the page body.

## What translates per locale

- The `title` and `description` frontmatter fields.
- Every paragraph of body prose.
- Every Mermaid node label.
- Every UI label that has a locale form in `services/platform/messages/<locale>.json`.

The full per-locale convention table (quotes, apostrophes, dates, numbers, currency, NBSP, ß, dashes) lives in the companion [`translation`](../translation/SKILL.md) skill.
