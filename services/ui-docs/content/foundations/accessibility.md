---
title: Accessibility
description: The WCAG 2.1 AA bar the system holds, the focus and labelling contracts, and how the guards check them.
---

Accessibility in this system is a floor, not a finishing pass. The bar is
**WCAG 2.1 AA**, and it is held by the components themselves — an icon button
that cannot be named does not compile, a disabled button with a reason stays
reachable, and the focus ring is one token rather than a per-component choice.

By the end of this page you will know what the components already guarantee,
what is still your responsibility, and how to check both.

## Contrast

Text clears **4.5:1**; non-text UI clears **3:1**. The measured ratios of the
two text tokens against the page background:

| Theme | Token | Ratio |
| --- | --- | --- |
| Light | `text-foreground` | ~19.3:1 |
| Light | `text-muted-foreground` | ~4.80:1 |
| Dark | `text-foreground` | ~19.1:1 |
| Dark | `text-muted-foreground` | ~9.0:1 |

`text-muted-foreground` is the floor, and it clears the bar in both themes.
That is why a raw Tailwind grey is a defect: the composer's data notice once
shipped as `text-gray-400 dark:text-gray-500`, which measured 2.81:1 in light
and 4.06:1 in dark — both under the bar for 12px text.

## Focus

<Demo name="foundations/focus-ring" />

Every interactive element is reachable by Tab and answers with a visible ring
built from `ring-ring` over `ring-offset-background`. The ring is
`focus-visible`, so it appears for keyboard focus and not on a mouse click.

`IconButton` deliberately overrides the ring to `ring-border-strong`: the full
ring read as a heavy halo around an otherwise quiet glyph. It is still visible,
still `focus-visible`, still on every icon button.

Start every page with a skip link:

```tsx
import { SkipLink } from '@tale/ui/skip-link';

<SkipLink>Skip to main content</SkipLink>
<main id="main" tabIndex={-1}>{/* … */}</main>
```

It moves focus into the target explicitly, because a browser following a
`#main` fragment does not reliably move focus — some only scroll, and headless
Chromium does neither.

## Labelling

| Role | Token | Rule |
| --- | --- | --- |
| Field label | `text-foreground` | `font-medium`, and a real `<label for>` |
| Field description | `text-muted-foreground` | One sentence under the label |
| Error message | `text-destructive` | Pair with `aria-invalid` and `role="alert"` |
| Section header | `text-foreground` | Heavier weight, above a group of fields |
| Section description | `text-muted-foreground` | One line under the header |

The form components wire this for you: `Input` renders its `label`,
`description`, `hint` and `errorMessage` through `FieldShell` with the ids
already connected. Reach for the raw element only when you are building a
control the package does not have — and then copy the same wiring.

An icon-only control needs `aria-label`; a tooltip is not a name. See
[Icons](/docs/foundations/icons) for why.

## Keyboard and overlays

- Every overlay traps focus, closes on **Escape**, and **restores focus to its
  trigger** when it closes.
- Arrow keys move within a menu; Tab moves between controls.
- A disabled button with a `disabledReason` stays focusable and hoverable so
  the reason can reach both pointer and keyboard users. It swaps `disabled` for
  `aria-disabled` and blocks Space and Enter, so it is still inert — it is just
  no longer invisible.
- A state-driven drawer (one without a Radix trigger) has nothing to restore
  focus to. Put focus back on the opener yourself once the exit animation
  releases the trap.

## Motion

`prefers-reduced-motion: reduce` collapses every animation and transition to
0.01ms globally, disables the named `--animate-*` keyframes and turns smooth
scrolling off. A component that animates with framer-motion should also honour
`useReducedMotion()` rather than relying on the global rule alone.

## How it is checked

- **`oxlint --type-aware`** runs the `jsx-a11y` ruleset — 27 rules covering
  ARIA validity, alt text, label association and role mismatches.
- **`checkAccessibility()`** wraps `vitest-axe` for component tests. It runs
  with `color-contrast` **disabled**: jsdom performs no layout and returns no
  real colours, so the rule can only ever report `incomplete`.
- **Real contrast** is judged in a browser, on the manual accessibility sweep,
  in both themes.

```ts
import { checkAccessibility } from '../../tests/utils/a11y';

it('has no accessibility violations', async () => {
  const { container } = render(<MyComponent />);
  await checkAccessibility(container);
});
```

Running axe in jsdom and calling contrast done is the one trap worth naming:
the rule never fails there, so it never protects you.

## Where to go next

[Button](/docs/components/button) is where these rules become concrete — it is
the component with the most accessibility machinery, and the page every other
component page copies.
