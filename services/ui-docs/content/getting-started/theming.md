---
title: Theming
description: The two token vocabularies, how dark mode is switched, and how a host tints the system with its own accent colour.
---

Every colour in the system resolves through a semantic token declared in
`packages/ui/src/globals.css`. A raw hex value in a component is a defect, not
a shortcut: it will be wrong in dark mode, it will drift from its neighbours,
and it cannot be retuned centrally.

By the end of this page you will know which token vocabulary to reach for,
exactly how the `.dark` class is applied, and how to let a host organization
tint the interface without touching a stylesheet.

## Two vocabularies live side by side

`globals.css` says so in its own header: *two token systems coexist*. Both are
real, both are supported, and both flip with the theme.

**The canonical family** is declared directly in `@theme` and overridden in
`.dark`. It reads as prose, and it is what newer components use:

```tsx
<div className="bg-bg-base text-fg-base border-border-base border">
  <p className="text-fg-muted">A description.</p>
</div>
```

**The HSL family** is the shadcn-shaped set — `--background`, `--foreground`,
`--muted`, `--border`, `--ring` — exposed through `hsl(var(--x))` aliases. It
is the page baseline: `body` is `bg-background text-foreground`, and
`@layer base { * { @apply border-border; } }` means a bare `border` class is
already themed.

```tsx
<div className="bg-background text-foreground border-border border">
  <p className="text-muted-foreground">A description.</p>
</div>
```

Neither is deprecated. Follow the surrounding file rather than converting one
into the other mid-component — a half-converted file is harder to read than
either whole.

<Demo name="foundations/color-tokens" />

The [Colours](/docs/foundations/colors) page lists every token with what it is
for.

## Dark mode is a class, not a media query

```css
/* packages/ui/src/globals.css */
@custom-variant dark (&:where(.dark, .dark *));
```

The `dark:` variant matches the **`.dark` class** on `<html>` (or any
descendant), never `prefers-color-scheme` directly. `tailwind-preset.ts` says
the same thing in ten lines: `darkMode: 'class'`.

`ThemeProvider` owns the class. It stores the choice under the localStorage key
`tale-theme`, resolves `'system'` through
`matchMedia('(prefers-color-scheme: dark)')`, toggles `.dark` on
`document.documentElement` and sets `colorScheme` alongside it. It also
suppresses transitions for one frame while flipping, so a theme change is a cut
rather than a smear of every animated property on the page.

Read and set the theme with `useTheme`:

```tsx
import { useTheme } from '@tale/ui/theme';

const { theme, resolvedTheme, setTheme } = useTheme();
// theme: 'light' | 'dark' | 'system'  — what the user chose
// resolvedTheme: 'light' | 'dark'     — what is actually painted
```

`theme` is the user's choice; `resolvedTheme` is what ended up on screen. Use
the second one whenever you need to branch on the painted result, such as
picking a chart palette.

Ship the picker with `ThemeSwitcher`, which has two variants — `menu` (an icon
button with a dropdown, the app default) and `segmented` (an inline pill, used
by the marketing footer). The switcher in this page's header is the `menu` one.

### Keep the favicon honest

A theme the user picked explicitly should also drive the favicon and the
`theme-color` meta tag, otherwise those keep following the OS. Mount
`ThemeAssets` inside the theme tree — usually from the root route — and give
your `index.html` the four ids it looks for: `favicon-light`, `favicon-dark`,
`theme-color`, `theme-color-dark`.

```tsx
import { ThemeAssets } from '@tale/ui/theme/assets';
```

## Accent colour is a context, not a token

An organization's brand colour cannot be a CSS token — it is per tenant and
arrives at runtime. It is a React context instead:

```tsx
import { AccentColorProvider } from '@tale/ui/accent-color';

<AccentColorProvider accentColor="#056CFF">{children}</AccentColorProvider>;
```

Components that tint read it with `useAccentColor()` and apply it as an inline
`style` — the active tab indicator and the active sub-panel row are the two in
the package today. Without a provider they fall back to the neutral treatment,
which is what this site shows. Leave the provider unmounted when you want the
plain design system.

Brand blue for Tale itself is `#056CFF`. In marketing surfaces it arrives as
`bg-brand-base` / `text-brand-fg` and is reserved for product life inside
demos — never a body-text colour, never a large fill.

## Rules that keep theming working

- **Never write a hex value in a class.** If no token fits, the token set is
  missing one; add it to `globals.css` with its `.dark` counterpart.
- **Branch on `resolvedTheme`, never on `matchMedia` in a component.** The
  provider already resolved it, and duplicating the query drifts during a flip.
- **Charts read `bg-chart-*` / `var(--color-chart-*)`.** They have their own
  light and dark scales precisely so a series is legible in both.

## Where to go next

[Colours](/docs/foundations/colors) has the full token list. If your component
renders strings of its own, [i18n](/docs/getting-started/i18n) is the next
piece of glue you need.
