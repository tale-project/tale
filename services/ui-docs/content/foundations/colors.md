---
title: Colours
description: Choose semantic surface, text, status, and chart colors that can adapt to light and dark themes.
---

Choose a color token for its role: page surface, secondary text, input edge, or status. This lets the shared stylesheet adjust the appearance centrally without changing each component. Avoid introducing raw palette colors in new UI code when an existing semantic token fits.

## Compare the two themes

<Demo name="foundations/color-tokens" />

Use the header theme menu to switch between **Light** and **Dark**. The swatches retain their class names while their values change. Check text against the surface it actually sits on, rather than judging an isolated swatch.

## Canonical semantic tokens

These tokens are declared in `@theme` in `packages/ui/src/globals.css`. The surface, text, border, and accent families have dark overrides.

| Utility | Intended role |
| --- | --- |
| `bg-bg-base` | Main component surface. |
| `bg-bg-elevated` | Raised or hovered surface. |
| `bg-bg-muted` | Quiet inset area. |
| `bg-bg-overlay` | Backdrop over other content. |
| `text-fg-base` | Primary text. |
| `text-fg-muted` | Supporting description. |
| `text-fg-subtle` | Metadata or captions; check the actual background. |
| `text-fg-inverse` | Text on a suitable inverted fill. |
| `border-border-base` | Dividers and ordinary surface edges. |
| `border-border-strong` | Stronger boundary treatment. |
| `border-border-input` | Form-control outline. |
| `bg-accent-base` with `text-accent-fg` | Primary neutral action fill and its foreground. |

`border-border-input` resolves to the strong border in light mode and the base border in dark mode. Use the input primitive for its full outline/focus treatment rather than approximating the field with a plain divider border.

The canonical status tints include `bg-success-bg`, `bg-warning-bg`, `bg-danger-bg`, `text-danger`, and `bg-info-bg`. These values do not all have dark overrides. Pair them deliberately, or use a shared status component that already applies the intended treatment.

## HSL-compatible aliases

The stylesheet also exposes the familiar HSL token family used by many existing components:

| Utilities | Intended pairing |
| --- | --- |
| `bg-background` and `text-foreground` | Page surface and primary text. |
| `bg-card` and `text-card-foreground` | Card surface and text. |
| `bg-popover` and `text-popover-foreground` | Menu or popover surface and text. |
| `bg-primary` and `text-primary-foreground` | Primary fill and text. |
| `bg-secondary` and `text-secondary-foreground` | Secondary fill and text. |
| `bg-muted` and `text-muted-foreground` | Quiet fill and supporting text. |
| `bg-accent` and `text-accent-foreground` | Highlighted surface and text. |
| `text-destructive` | Error text or a destructive affordance. |
| `bg-success`, `bg-warning`, `bg-info` | Status fills, each with a corresponding `-foreground` token. |
| `border-border`, `bg-input`, `ring-ring` | Ordinary border, field fill, and focus-ring role. |
| `bg-sidebar`, `bg-tab` | Navigation and selected-tab surfaces. |

Follow the existing file's family rather than partially converting its colors while adding an unrelated feature. The canonical and HSL names are supported vocabularies, not interchangeable values you can mix without checking the result.

## Use chart-specific colors

Charts have `chart-1` through `chart-5` plus `chart-success`, `chart-failure`, `chart-warning`, `chart-neutral`, and `chart-primary`. CSS consumers can read `var(--color-chart-1)` and its siblings; Tailwind exposes the corresponding color utilities.

Use labels, shapes, or line patterns as well as color to distinguish meaningful series. Verify legends and tooltips in both themes, including small text and a single low-value data point.

## Add a color only when the meaning is missing

First inspect the existing tokens and neighboring components. If a new semantic role is needed, add its token and intended theme treatment centrally. Record which foreground/background pairing it supports and check rest, hover, focus, selected, and error states.

A host accent is a separate runtime input used by participating components; see [Theming](/docs/getting-started/theming). Neither an accent color nor a semantic token removes the need for the rendered [accessibility review](/docs/foundations/accessibility).
