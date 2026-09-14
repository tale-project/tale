---
title: Accessibility
description: Combine the components with clear names, keyboard paths, readable contrast, and motion-aware behavior.
---

Tale targets WCAG 2.1 AA. Shared components provide useful semantics and interaction, but a complete screen still needs a human review: labels, focus order, contrast, and recovery depend on how you compose them.

## Start with names and structure

Give each page one accessible `h1`, then organize its sections without skipping heading levels. The application header can supply that title; do not duplicate it in the body or omit it because the page appears in navigation.

| Surface | What you supply |
| --- | --- |
| Text button | A meaningful visible action label. |
| Icon button | `aria-label`; an icon-sized `Button` also accepts `title` as its name. |
| Input | `label`, or a deliberate accessible name when a visible label is supplied elsewhere. |
| Dialog | A required title, useful context, and named controls. |
| Data table | A descriptive caption and understandable column headings. |
| Tabs or navigation | A name for the list/landmark and clear destination labels. |

A tooltip alone does not name a control. Decorative icons beside text should be hidden from assistive technology. Validation should include readable error text, not only a red border; [`Input`](/docs/components/input) associates that feedback with its control.

## Walk the keyboard path

<Demo name="foundations/focus-ring" />

Use Tab and Shift+Tab to move through this example. Focus should be visible and its order should follow the task. Try Enter or Space on actions and arrow keys within composite controls such as tabs and menus.

Add a skip link before repeated navigation:

```tsx
import { SkipLink } from '@tale/ui/skip-link';

export function PageFrame() {
  return (
    <>
      <SkipLink>Skip to main content</SkipLink>
      <main id="main" tabIndex={-1}>
        <h1>Example page</h1>
      </main>
    </>
  );
}
```

The target must accept programmatic focus. `tabIndex={-1}` makes the main region focusable without adding another ordinary Tab stop. Test the first Tab after a fresh deep-link load: initial scrolling or autofocus must not unexpectedly bypass the skip link.

## Check overlays and disabled controls

A modal dialog traps focus while open and should return it to a useful opener on close. If that opener unmounts, supply a stable `restoreFocusRef`. Test Escape, explicit cancellation, completion, and a failed request. Nonmodal tooltips and popovers do not all share modal focus behavior; do not assume every overlay traps focus.

`disabledReason` keeps supported disabled controls reachable so people can discover why an action is unavailable. Check both the tooltip and the blocked action. Keep essential instructions visible outside the tooltip as well.

## Measure contrast in the rendered state

For ordinary text, check 4.5:1 contrast; large text and meaningful non-text UI have different criteria. Use semantic foreground/background pairs, then measure the actual pairing in light and dark themes. Muted text, placeholder text, status colors, and host accents deserve particular attention.

The package's token names are not a guarantee that every combination passes. Opacity, an image underneath, a hover fill, or a disabled treatment can change the result. Do not carry a ratio measured against one surface over to another. [Colours](/docs/foundations/colors) explains the available pairings.

## Respect motion and timing preferences

The shared stylesheet reduces CSS animation and transition durations and disables smooth scrolling under `prefers-reduced-motion: reduce`. JavaScript-driven motion needs its own handling: use the motion library's reduced-motion support, and request instant scrolling when the preference is active.

A disappearing toast must not be the only location for information someone needs to continue. A five-second timeout alone does not establish compliance with [WCAG timing requirements](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html).

## Combine automated and manual checks

Type checks catch missing required icon labels; lint checks catch many invalid roles and associations. Component tests use `checkAccessibility()` with axe. That helper disables contrast checking in jsdom because it has no real layout or painted colors.

Before shipping a page, complete its main task with the keyboard, inspect it at a narrow width and increased text size, test both themes and reduced motion, and verify focus after dialogs and navigation. Include error and empty states. An automated axe pass is evidence about the rules it can inspect, not proof that the entire experience is accessible.
