---
title: Introduction
description: What the Tale design system is, why it ships as two packages, and which one you should be reaching for.
---

Tale ships one design system in two packages, because a product screen and a
landing page are not the same problem. `@tale/ui` is the **app language** — the
components, hooks and tokens the platform is assembled from. `@tale/marketing-ui`
is the **marketing language** — the site chrome, page sections and product-demo
frames that tale.dev is assembled from, layered on top of `@tale/ui`.

By the end of this section you will know which package a given screen belongs
to, how the two relate at runtime, and what stays in your service instead of
moving into a package.

## Pick the language before you pick the component

The split is not stylistic decoration. The two languages answer to different
readers, and mixing them is the fastest way to make a screen look wrong.

| | App language (`@tale/ui`) | Marketing language (`@tale/marketing-ui`) |
| --- | --- | --- |
| Used by | the platform, this site's `/docs` pages, any Tale-project app | tale.dev, this site's front page |
| Reader | someone doing work, many times a day | someone deciding, once |
| Surface | `bg-background`, `bg-bg-base` — flat, quiet | `bg-surface-site` — cool stone paper, atmosphere |
| Type | Inter, weight 500–600, `text-base` headings | Inter, weight 400, display sizes up to 80px |
| Controls | one height (`h-9`), square-ish radii | pill buttons, generous bands |
| Motion | state transitions only | scroll reveals, demo timelines |

You are reading both right now. This page is the app language; the
[front page](/) is the marketing one.

## How the packages relate

`@tale/marketing-ui` declares `@tale/ui` as a **peer dependency** and imports
from it directly — `cn`, `Button`, `Tooltip`, the logo, the i18n glue and every
colour token come from there. The marketing package adds only what a marketing
page needs, and its stylesheet pulls the app one in:

```css
/* @tale/marketing-ui/globals.css, first line */
@import '@tale/ui/globals.css';
```

That is why a marketing site imports one stylesheet and gets both vocabularies,
while an app imports `@tale/ui/globals.css` and gets only the app one.

Both packages are **source-consumed**: there is no build step, and a consumer
imports straight from `src/` through the `exports` map in `package.json`. That
map is the public surface — one subpath per module, so
`import { Button } from '@tale/ui/button'` is the only way in, and a deep
relative import into `src/` is not supported.

## What belongs in a package, and what does not

A component earns its place in `@tale/ui` when it is reusable UI. It loses that
place the moment it learns about Tale's business:

- **In the package**: a `DataTable` that takes columns and rows; a `Dialog`
  that takes a title and a footer; a `FieldShell` that lays a label out beside
  its control.
- **In your service**: anything that knows an organization id, an ability
  check, or a backend query. Wrap the package primitive in a service component
  and pass it what it needs through props.

The same rule draws the line for strings. A component that renders text of its
own reads it from the package catalog with `useT('<namespace>')`; text that
belongs to a screen is passed in as a prop.

## What this site gives you

- **[Installation](/docs/getting-started/installation)** — use the packages
  inside this monorepo, or install them from GitHub in another repository.
- **[Foundations](/docs/foundations/colors)** — the tokens every component
  resolves through, and the rules that keep them consistent.
- **[Components](/docs/components/button)** — one page per component, each
  with live examples and a props table taken from the source.
- **[Patterns](/docs/patterns/list-page)** — how the components compose into
  the screens the product actually ships.
- **[Marketing UI](/docs/marketing-ui/overview)** — the other language.

Every example on this site is the real component running in your browser, not a
screenshot. Open the **Code** panel under any of them to see the exact source
that produced what you are looking at.

## Where to go next

If you are adding a screen inside this monorepo, go straight to
[Foundations](/docs/foundations/colors) — the packages are already wired up for
you. If you are pulling the design system into another repository, start with
[Installation](/docs/getting-started/installation), which carries the exact
requirements on the consumer side.
