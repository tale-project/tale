# Write a design-system guide

Help a reader build a working screen with the shipped packages. Follow the
[write-docs method](../../../.agents/skills/write-docs/SKILL.md); this contract
adds the routing, example, and verification rules specific to this site.

## Choose the reader’s task

Use a tutorial for the first working control, a how-to for a composition, an
explanation for a design decision, and reference for exact interfaces. A component
page usually needs an example, state choices, host responsibilities, and accessibility
guidance. Arrange those details around the task; a fixed section count, exhaustive
prop dump, or closing recap is not required.

Read the component source and its tests before describing props, defaults, focus,
loading, or persistence. Drive the rendered example. Distinguish the package’s
behavior from the host’s work: a Save button does not persist data, and a local
example does not establish a platform business rule. Explain the result and recovery
where a reader would otherwise hesitate.

## Add the page and its navigation

Place a page at `content/<section>/<slug>.md`, with `section` in `getting-started`,
`foundations`, `components`, `patterns`, or `marketing-ui`. Files directly in
`content/`, including this contract, are excluded from the page walk.

```yaml
---
title: Button
description: Choose an action style and handle loading or unavailable actions.
---
```

The article header renders `title` as the page’s only accessible `h1` (the trail in
the header strip above it names the page without a heading); body headings begin
at `##`. `description` appears below the title, in metadata, and in search results.
Write a useful sentence. Set optional `noindex: true` only when a page should be
excluded from the sitemap.

Add the slug to [nav.json](nav.json). Its order also controls previous/next links.
Group labels resolve through `nav.groups.<label>` in all three service catalogs.
Use site links such as `/docs/components/input`, and test any heading fragment
against the rendered ID. The navigation and content tests enforce file/nav parity,
frontmatter, and heading structure.

## Show the actual component

The shared Markdown registry supports callouts, steps, tabs, code groups, frames,
cards, and accordions. Use them when they make a decision or sequence clearer.
This site additionally renders live examples:

```md
<Demo name="button/variants" />
```

That name resolves to `app/demos/button/variants.tsx`. Each demo default-exports
one prop-less component and imports public package subpaths such as `@tale/ui/button`.
The wrapper supplies the preview, theme, Code toggle, and source-copy control.
Keep the example small enough to understand as a complete file; explain additional
providers or dependencies in the guide. Mark partial code blocks as excerpts and
name the values the host must supply.

Demo strings are plain English sample code. Service chrome uses translated catalogs;
shared control strings come from package catalogs. Do not add `useT` calls to sample
code solely to translate its fictional values. Use semantic tokens, not raw palette
colors, in demo styling. Reference every demo from a page; the demo test rejects
missing and orphan examples.

A page-layout example that introduces another application header must be a labelled
illustration, with `role="img"` around an `aria-hidden`, `inert` payload. See
`app/demos/app-shell/page-layout.tsx`. Explain that it is an illustration and link
to interactive examples for the controls it contains. Never place required actions
inside an inert frame. Mount one toast viewport at the site root; individual demos
trigger it without mounting another.

## Keep language and scope honest

Write clear English addressed to `you`, with concrete actions and exact labels.
Avoid claims that a task is easy, promotional adjectives, and repeated introductions.
The guide bodies and routes are intentionally English-only. Chrome catalogs in
`messages/{en,de,fr}.yml` remain complete and receive a native-language review under
[write-translations](../../../.agents/skills/write-translations/SKILL.md).

Use real interactive examples when they explain behavior better than a static image.
Any shipped screenshot still follows the repository’s reproducible capture pipeline.
Do not invent a component state or an output to make an example appear complete.

## Verify the published experience

Run these commands from the repository root after installing its pinned Bun version:

```bash
bun run --filter @tale/ui-docs build:content
bun run --filter @tale/ui-docs test
bun run --filter @tale/ui-docs typecheck
bun run --filter @tale/ui-docs lint
bun run --filter @tale/ui-docs build
```

Commit the regenerated `app/content/frontmatter.json`. The search index and build
outputs are generated and ignored. Restart the dev server after content changes when
checking search: `dev` builds its index at startup.

Read the rendered page in both themes at desktop and phone widths. Complete the
example, inspect its Code panel, follow related links, and check keyboard names,
focus, and overflow. Check the built Markdown twin and page HTML when changing
routing or metadata. Tests prove structure; source review and observed outcomes
prove whether the guide teaches the right behavior.
