---
title: Button
description: The primary control of the system — its variants, its single height, and the accessibility machinery it carries for you.
---

`Button` is the control every other one is measured against. It carries one
height, a fixed set of variants, a loading state, an explanation for why it is
disabled, and the type-level rule that an icon-only button must be named.

This page is the template every other component page on this site follows:
what it looks like, every axis it has, its real props, its accessibility
contract, and when to reach for something else.

```tsx
import { Button } from '@tale/ui/button';
```

## Variants

<Demo name="button/variants" />

| Variant | Use it for |
| --- | --- |
| `primary` (default) | The one action the screen is for |
| `secondary` | Everything beside the primary action |
| `ghost` | A control inside a dense row or toolbar |
| `destructive` | Deleting, revoking, disconnecting |
| `warning` | An action with a cost that is not destruction |
| `success` | Confirming a positive terminal state |
| `link` | An action that reads as text in a sentence |

One primary per view. A screen with three primary buttons has no primary
button.

## Sizes

<Demo name="button/sizes" />

`default` is `h-9` and `sm` is `h-8` — the same two heights every control in
the system has. `icon` and `icon-sm` are their square counterparts. There is
deliberately no large size: a page's call to action is the same height as the
field above it.

## With an icon

<Demo name="button/with-icon" />

Pass a Lucide component through `icon` rather than putting an `<svg>` in the
children. The button renders it at `size-4`, spaces it for you, and marks it
`aria-hidden` — the label is already the accessible name.

`collapseLabel` hides the text below the `sm` breakpoint while keeping it in
the accessibility tree, so a crowded mobile toolbar stays usable without losing
the button's name.

## Loading

<Demo name="button/loading" />

`isLoading` swaps the leading icon for a spinner, sets `aria-busy`, and
disables the button. The label stays — a button that changes its text while
working makes the row reflow and loses the reader's place.

## Disabled, with a reason

<Demo name="button/disabled-reason" />

A plain `disabled` button is a dead end: the reader can see that they cannot
act, but not why. `disabledReason` fixes that, and the implementation is the
interesting part.

A natively `disabled` button emits no pointer events and leaves the tab order,
so neither a hover nor a focus tooltip could ever reach it. When a disabled
button carries a reason, the component keeps it focusable, swaps the native
`disabled` attribute for `aria-disabled`, blocks Space and Enter so activation
is still inert, and lets the tooltip wire `aria-describedby`. The reason
reaches pointer and keyboard users alike.

It only applies while `disabled` is true, so you can pass it unconditionally.

## `asChild`

<Demo name="button/as-child" />

`asChild` renders the button's styling onto its single child through a Radix
`Slot` — the usual reason is to make a link look like a button.

Two things switch off under `asChild`, both deliberately: the tooltip (the
button is then a slot, usually another overlay's trigger, and wrapping a slot
in a tooltip trigger breaks that composition) and `disabledReason` (it needs a
real button to soft-disable).

For an internal route, prefer `LinkButton`, which is the same styling around a
router `Link` and takes `params`, `search` and `prefetch`.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'destructive' \| 'warning' \| 'success' \| 'link'` | `'primary'` | |
| `size` | `'default' \| 'sm' \| 'icon' \| 'icon-sm'` | `'default'` | An icon size requires `aria-label` or `title` |
| `asChild` | `boolean` | `false` | Render onto the single child |
| `isLoading` | `boolean` | `false` | Spinner, `aria-busy`, disabled |
| `icon` | `LucideIcon` | — | Leading icon, rendered at `size-4` |
| `iconClassName` | `string` | — | Extra classes on the icon |
| `fullWidth` | `boolean` | `false` | Stretch to the container |
| `collapseLabel` | `boolean` | `false` | Icon-only below `sm`, label stays `sr-only` |
| `title` | `string` | — | Names an icon button **and** shows a tooltip |
| `tooltip` | `ReactNode` | — | Rich tooltip content; overrides `title` visually |
| `tooltipSide` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'top'` | |
| `tooltipOpen` | `boolean` | — | Controlled tooltip, for toggles that announce the new state |
| `onTooltipOpenChange` | `(open: boolean) => void` | — | Pairs with `tooltipOpen` |
| `disabledReason` | `ReactNode` | — | Why it is disabled; see above |

Every remaining `<button>` attribute passes through.

## Accessibility

- **An icon-only button must be named.** The prop types enforce it: a button is
  valid when it carries `aria-label`, or `title`, or a non-icon size.
- **`title` names an icon button only.** A text button keeps its name from its
  children, so `title` there is a tooltip and nothing more. The native `title`
  attribute is dropped either way, so the browser does not pop a second
  tooltip.
- **The focus ring is `ring-ring` over `ring-offset-background`**, on
  `focus-visible` only.
- **Cursor is global.** `button:not(:disabled)` is `cursor: pointer` in the
  base layer, and a disabled one is `not-allowed`. Never re-add
  `cursor-pointer` per button.
- **`active:scale` and every transition drop out** under
  `prefers-reduced-motion`.

## When to use something else

| Instead of | Use |
| --- | --- |
| A button that navigates a route | `LinkButton`, or `Button asChild` around a `Link` |
| An icon-only control in a toolbar | `IconButton` — it requires a name and tunes the ring |
| An action inside a table row | `DataTable`'s `actionMenu` / `createActionsColumn` |
| The primary create action on a list page | `DataTable`'s `addAction`, so size and placement stay consistent |

## Where to go next

[Input](/docs/components/input) is the other half of every form, and it shares
this component's height and disabled-reason contract.
