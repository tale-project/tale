---
title: Colours
description: Every semantic colour token in the system, which vocabulary it belongs to, and what it is for.
---

There is no palette to choose from. Every colour in a Tale interface resolves
through a semantic token, so the same class produces the right result in light
and dark, and a retune happens in one file rather than in four hundred
components.

This page is the reference: the two vocabularies, the full token list, and the
rules that keep them from drifting.

## The swatches

<Demo name="foundations/color-tokens" />

Toggle the theme in the header and watch the same classes repaint. That is the
entire point of a token.

## The canonical family

Declared directly in `@theme` and overridden inside `.dark`.

| Utility | Use it for |
| --- | --- |
| `bg-bg-base` | The page or card ground plane |
| `bg-bg-elevated` | Hover fill, raised rows, secondary button rest |
| `bg-bg-muted` | Quiet wells, inert chips, inactive fills |
| `bg-bg-overlay` | The scrim behind a modal or sheet |
| `text-fg-base` | Primary text, headings, the active nav row |
| `text-fg-muted` | Descriptions, body prose under a label |
| `text-fg-subtle` | Captions, metadata, code line numbers |
| `text-fg-inverse` | Text sitting on an inverted or accent fill |
| `border-border-base` | The default hairline: cards, dividers, header rules |
| `border-border-strong` | Hover border lift, secondary-button ring |
| `border-border-input` | A form field's edge, and nothing else |
| `bg-accent-base` | The neutral ink accent — primary button, active indicator |
| `text-accent-fg` | Text or icon on `accent-base` |

`border-border-input` exists because the plain border is near-invisible on
white — about 1.2:1 — so a field would lose its shape. In light mode it
resolves to the strong border; in dark mode it drops back to the base one,
where the contrast is already there.

Status tints carry the same value in both themes, because a red that is
recognisably red matters more here than a perfectly balanced surface:
`bg-success-bg`, `bg-warning-bg`, `bg-danger-bg`, `text-danger`, `bg-info-bg`.

## The HSL family

The shadcn-shaped set, exposed as `hsl(var(--x))` aliases. It is the page
baseline: `body` is `bg-background text-foreground`.

| Utility | Use it for |
| --- | --- |
| `bg-background` / `text-foreground` | The page ground and its primary text |
| `bg-card` / `text-card-foreground` | A card surface that must sit above the page |
| `bg-popover` / `text-popover-foreground` | Menus, popovers, the command palette |
| `bg-primary` / `text-primary-foreground` | The primary control fill |
| `bg-secondary` / `text-secondary-foreground` | The secondary control fill |
| `bg-muted` / `text-muted-foreground` | Quiet fills, hover rows, secondary text |
| `bg-accent` / `text-accent-foreground` | The hovered or highlighted row in a list |
| `text-destructive` | Inline validation errors, destructive affordances |
| `bg-success` · `bg-warning` · `bg-info` | Status fills with their `-foreground` pairs |
| `border-border` | The default border — already applied to every element |
| `bg-input` | A field's own fill |
| `ring-ring` | The focus ring, with `ring-offset-background` |
| `bg-sidebar` · `bg-tab` | The two chrome surfaces with their own value |

Charts get their own scales — `bg-chart-1` through `bg-chart-5`, plus
`bg-chart-success`, `bg-chart-failure`, `bg-chart-warning`, `bg-chart-neutral`
and `bg-chart-primary` — tuned separately for light and dark so a series stays
legible in both. A chart that reads a hex value is a chart that disappears when
the theme flips.

## Which family should a new component use?

Follow the file you are in. Both vocabularies are supported and both flip with
the theme, so consistency inside one component is worth more than consistency
across the package. When you are starting a file from scratch, the canonical
family reads better in review — `text-fg-muted` says what it is for, where
`text-muted-foreground` says what it is made of.

## The rules

- **Never a raw hex, never a Tailwind grey.** `text-gray-400` is not a token;
  it will not flip, and it has already shipped a contrast failure once.
- **Dark surfaces use the neutral scale, not `gray`.** Tailwind's `gray` is
  blue-tinted, which gave the app a cold cast.
- **Meaning picks the token, not appearance.** A muted description is
  `text-muted-foreground` because it is a description — not because that
  happens to be the grey you wanted.
- **Contrast is a requirement, not a preference.** `text-muted-foreground`
  clears 4.5:1 on the page background in both themes;
  [Accessibility](/docs/foundations/accessibility) has the measured numbers.

## Where to go next

[Typography](/docs/foundations/typography) covers the other half of the visual
baseline, and [Theming](/docs/getting-started/theming) explains how the `.dark`
class gets applied in the first place.
