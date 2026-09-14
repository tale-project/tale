---
title: Spacing and layout
description: One control height, one gap scale, one bordered surface, and the containers that hold a page together.
---

The layout rules are short and deliberately strict, because most visual
inconsistency in an app is not colour — it is a control that is two pixels
taller than its neighbour and a gap that nobody chose.

By the end of this page you will know the one control height, the gap steps you
may use, and which container a given page belongs in.

## One control height

<Demo name="foundations/control-heights" />

`h-9` is the height of every control: buttons, inputs, selects, date pickers,
the search trigger. `h-8` is the single smaller variant, for dense bars and
toolbars. There is deliberately **no large size** — a page's primary call to
action is the same height as the field above it.

| Size | Button | Icon button |
| --- | --- | --- |
| default | `h-9 px-4` | `size-9` |
| `sm` | `h-8 px-3 text-xs` | `size-8` |

Chrome rows have their own fixed height: the page header strip and the tab
strip are **`h-13` (52px)**, which is also what the rail's logo row uses, so
the two bottom borders meet as one line across the viewport.

## The gap scale

`Stack`, `Row` and `Grid` take a `gap` from a named scale rather than an
arbitrary class. Pick a step; never write `gap-[14px]`.

| Step | Use it for |
| --- | --- |
| `2` | Inside a field group — label, control, hint |
| `4` | Inside a section. The default, and usually right |
| `6` | Loose grouping in a wide section |
| `8` | Between sections — the settings page rhythm |

`0`, `1`, `3`, `5`, `10` and `12` exist; `5`, `10` and `12` are legacy steps
kept for old code. Reach for them only when you are matching a file that
already uses them.

```tsx
import { Grid, Row, Stack } from '@tale/ui/layout';

<Stack gap={8}>
  <Stack gap={4}>
    <Row gap={2}>{/* … */}</Row>
  </Stack>
</Stack>;
```

All three are polymorphic: pass `as="section"` (or `asChild`) instead of
wrapping them in another element just to get the right tag.

## Radius

| Token | Value | Where |
| --- | --- | --- |
| `rounded-sm` | 6px | Focus targets, small chips |
| `rounded-md` | 8px | Dense controls (`sm` buttons, nav rows) |
| `rounded-lg` | 8px | Buttons, inputs, the default card |
| `rounded-xl` | 16px | Cards that want to read as a panel |

## `Card` is the one bordered surface

Every card-like surface in the product — a catalog tile, a settings panel, a
kanban task, a stat cell — is a `Card` with a different padding. A hand-rolled
`rounded-lg border bg-background p-4` is the thing this component exists to
prevent.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@tale/ui/card';

<Card padding="md">
  <CardHeader>
    <CardTitle>Members</CardTitle>
  </CardHeader>
  <CardContent>{/* … */}</CardContent>
</Card>;
```

| Prop | Values | Default |
| --- | --- | --- |
| `padding` | `none` `sm` (12px) `md` (16px) `lg` (20px) `xl` (24px) | `xl` |
| `radius` | `lg` `xl` | `lg` |
| `shadow` | `none` `sm` `md` | `none` |
| `interactive` | hover border lift plus a focus ring | `false` |
| `asChild` | render as the child element (`button`, `a`, `Link`) | `false` |

Pair `interactive` with `asChild` so the card **is** the interactive node — the
focus ring only renders on the focused element, so a ring on a `div` wrapping a
link never appears.

## Containers

| Component | Width | Use it for |
| --- | --- | --- |
| `Container` | `max-w-7xl` by default (`md`/`lg`/`xl`/`full`) | A generic page frame |
| `NarrowContainer` | `max-w-136` (544px) | A form or a single-column config page |
| `ContentArea` | `page` / `narrow` (`max-w-3xl`) / `panel` | The body of an app page |
| `Section` | vertical rhythm, `sm`/`md`/`lg` | A marketing-style band |

`ContentArea variant="narrow"` is the settings measure. It also declares the
**row field layout** — label on the left, control on the right from `sm` up —
so every field on the page lines up without a single layout class at the call
site. That is the mechanism the
[settings page pattern](/docs/patterns/settings-page) is built on.

The main column is width-capped rather than full-bleed, and a secondary panel
**resizes** the main column rather than floating over it.

## Where to go next

[Icons](/docs/foundations/icons) finishes the visual baseline, and
[App shell](/docs/components/app-shell) shows these containers assembled into a
real page.
