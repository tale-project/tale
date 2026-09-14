# Authoring design-system documentation

Every page under this directory becomes a route at `/docs/<path-without-.md>`.
This file is the contract for adding one; it is skipped by the content walk, so
it never becomes a page itself.

Read [`.agents/skills/write-docs/SKILL.md`](../../../.agents/skills/write-docs/SKILL.md)
first — it owns the method (journey-first, show before you tell, prove with
code, truth over polish). What follows is only what is specific to this site.

## Where a page lives

```
content/<section>/<slug>.md
```

`<section>` is one of `getting-started`, `foundations`, `components`,
`patterns`, `marketing-ui`. A file directly in `content/` is not a page — the
walk requires a section folder.

## Frontmatter

```yaml
---
title: Button
description: One sentence. It is the page's meta description and the text under the title.
noindex: false # optional; omit unless the page must stay out of the sitemap
---
```

`title` is rendered as the page's **only `h1`**, in the header strip — so a
page body **never starts with `# Heading`**. Start at `##`. A test enforces
this, because a second `h1` breaks the outline for a screen reader.

`description` is used three times: the meta description, the sentence under the
title, and the search result's subtitle. Write it as a sentence, not a label.

## Navigation

A page is only reachable once it is in [`nav.json`](nav.json):

```json
{ "label": "components", "pages": ["components/button"] }
```

`label` resolves through `nav.groups.<label>` in `messages/{en,de,fr}.yml`, so a
new group needs its key in **every** locale. Nav order is also prev/next order.

`tests/navigation.test.ts` fails when a nav entry has no file, or a file has no
nav entry.

## Live examples

The renderer is the shared markdown registry (callouts, steps, tabs, code
groups, frames, cards, accordions) plus one tag this site adds:

```md
<Demo name="button/variants" />
```

`name` is the path of a file under `app/demos/`, without the extension. The
preview surface, the theme, the **Code** toggle and the copy button are the
component's job; the demo file only renders the example.

### Demo file rules

- One file per example, default-exporting a component with **no props**:
  `app/demos/<family>/<name>.tsx`.
- Small and self-contained. A reader should be able to paste it into a file and
  have it work.
- Import from the real package subpaths (`@tale/ui/button`), never a relative
  path into `packages/`.
- Plain English string literals, like a Storybook story. Demos are sample code,
  not product UI, and `useT` calls would make them unreadable as examples.
- Tokens only — no hex values, no raw greys. The demo is also an example of the
  rules the page describes.
- **Page chrome needs a frame.** A component that renders its own `h1`
  (`AdaptiveHeaderTitle`, `HeaderBreadcrumbs`) would add a second one to the
  page. Wrap those demos in `role="img"` + `aria-label` with an `aria-hidden`
  `inert` payload, the way `DemoShell` does — see
  `app/demos/app-shell/page-layout.tsx`.

`tests/demos.test.ts` fails when a page references a demo that does not exist,
and when a demo file is not referenced by any page.

## Voice

- Second person, informal. Never "we", never "the user".
- Imperative for instructions, with the consequence before the step.
- Strike on sight: `simply`, `easy`, `just`, `seamless`, exclamation marks.
- Verify every prop name, default and type against the component source before
  you write it down. An invented prop is the one defect this site cannot
  recover from.

## Page shape for a component

The [Button page](components/button.md) is the template. In order:

1. Two or three sentences on what the component is and what it carries for you.
2. `<Demo>` of the main axis (variants), with a table explaining when to use
   which.
3. The other axes — sizes, icon, loading, disabled, `asChild` — each with a
   demo or a short code block.
4. **Props** — a table taken from the real interface, with types and defaults.
5. **Accessibility** — what the component guarantees, what you still owe.
6. **When to use something else** — a table pointing at the right neighbour.
7. **Where to go next** — a named closing, not a `## Next` stub.

## Checking your work

```bash
bun run --filter @tale/ui-docs dev        # http://localhost:3003
bun run --filter @tale/ui-docs test       # nav, demo and frontmatter parity
bun run --filter @tale/ui-docs typecheck
bun run --filter @tale/ui-docs lint
```

View the page rendered, in both themes, before calling it done.
