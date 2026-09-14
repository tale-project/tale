---
title: Typography
description: One typeface, two components, and the heading rules that keep a page's outline readable by a screen reader.
---

The system ships one typeface and two components that render text. `Heading`
owns size and weight; `Text` owns the small variant scale everything else
draws from. Between them there is almost no reason to write a raw
`text-sm font-medium` in a component.

By the end of this page you will know which component to use, how size and
semantics stay separate, and the heading rules a page has to hold.

## The scale

<Demo name="foundations/type-scale" />

## Inter, self-hosted

Inter is the only family, loaded from `@fontsource/inter` at weights **400,
500, 600 and 700**. It is imported as a JavaScript side effect from
`packages/ui/src/fonts.ts`, which `AppShell` pulls in — not through a CSS
`@import`, because Tailwind v4 inlines imported CSS without rebasing its
`url()` references, which leaves the font files 404ing.

Two details follow from that:

- The Latin 400 and 500 files are preloaded at boot, so the first paint does
  not flash a fallback face.
- The fallback is metric-matched to Arial (`'Inter Fallback'`), so the swap
  does not reflow the page.

Monospace is a stack, not a bundled face:
`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.

## `Heading` — size and level are different axes

```tsx
import { Heading } from '@tale/ui/heading';

<Heading level={2} size="lg">
  Members
</Heading>;
```

| Prop | Values | Default |
| --- | --- | --- |
| `level` | `1`–`6` — the element that is rendered | `2` |
| `size` | `xs` `sm` `base` `lg` `xl` `2xl` | `base` |
| `weight` | `medium` `semibold` `bold` | `semibold` |
| `tracking` | `tighter` `tight` `normal` | — |
| `truncate` | adds `min-w-0 truncate` | `false` |

Keeping the two axes apart is what lets a section heading three levels deep
still be the right size, and it is why a page never has to fake an outline with
a `div`.

`truncate` adds `min-w-0` alongside the ellipsis on purpose: a flex child
without it refuses to shrink, and the ellipsis never appears.

## `Text` — the variant scale

```tsx
import { Text } from '@tale/ui/text';

<Text variant="muted">Send a Monday summary to every member.</Text>;
```

| Variant | Renders as |
| --- | --- |
| `body` (default) | `text-foreground text-sm` |
| `body-sm` | `text-foreground text-xs` |
| `muted` | `text-muted-foreground text-sm` |
| `caption` | `text-muted-foreground text-xs` |
| `label` | `text-foreground text-sm font-medium` |
| `label-sm` | `text-foreground text-xs font-medium` |
| `code` | `font-mono text-xs` |
| `error` | `text-destructive text-sm` |
| `success` | `text-success text-sm font-medium` |

`as` picks the element (`p`, `span`, `div`, `label`, `h3`), and `truncate` and
`align` are available where they make sense.

## The heading rules

- **One `h1` per page.** In the app that `h1` is the page title in the header
  strip — `AdaptiveHeaderTitle` renders it, or `HeaderBreadcrumbs` renders it
  as the leaf of the trail. The body starts at `h2`.
- **Never skip a level.** `h1` → `h2` → `h3`. Settings pages are the usual
  offender, because they look like a flat list of fields but are a nested
  outline.
- **Settings pages carry no page title.** The rail or the tab already named the
  page; repeating it wastes the row and duplicates the `h1`.
- **A card title is an `h3`.** `CardTitle` renders one, so a card inside a
  section under the page title lands at the right depth.

## Marketing type is a different scale

The marketing language uses the same family at **weight 400** with tight
tracking, at display sizes up to 80px, through `SectionHeading`. It is
deliberately not reachable from an app screen — see
[Marketing UI](/docs/marketing-ui/overview).

## Where to go next

[Spacing and layout](/docs/foundations/spacing-and-layout) covers the geometry
these type sizes sit on.
