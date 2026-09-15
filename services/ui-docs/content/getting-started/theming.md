---
title: Theming
description: Enable light and dark themes, choose semantic colors, and apply an optional host accent.
---

Semantic color tokens let a component keep the same classes in light and dark themes. Mount the shared theme provider, then choose colors by their purpose rather than their current appearance.

## Enable theme switching

[Installation](/docs/getting-started/installation) mounts the provider with `<AppShell theme>`. Its default choice is `system`; `ThemeProvider` resolves the operating system preference and applies `.dark` to the document when needed. An explicit choice is saved under `tale-theme` in local storage.

```tsx
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

export function AppearanceControl() {
  return <ThemeSwitcher />;
}
```

Try the theme control in this page's header. Choose **Dark**, then **Light**, and compare the swatches below. Choose **System** to follow the operating system again.

<Demo name="foundations/color-tokens" />

`ThemeSwitcher` defaults to a menu. Its `segmented` variant presents the choices inline. Both must live inside the provider tree.

## Read the choice or the displayed result

```tsx
import { useTheme } from '@tale/ui/theme';

export function ThemeSummary() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme('system')}>
      Preference: {theme}; displayed theme: {resolvedTheme}
    </button>
  );
}
```

`theme` is `light`, `dark`, or `system`. `resolvedTheme` is the resulting `light` or `dark`. Use the resolved value when selecting an image or chart palette. Querying `prefers-color-scheme` independently would ignore an explicit user choice.

The Tailwind `dark:` variant follows the `.dark` class. The provider also updates CSS `color-scheme` and briefly suppresses transitions during a switch. This avoids animating every color on the page at once.

## Choose a token family consistently

The stylesheet exposes two supported families:

| Family | Example surface | Example secondary text |
| --- | --- | --- |
| Canonical semantic tokens | `bg-bg-base text-fg-base border-border-base` | `text-fg-muted` |
| HSL-compatible aliases | `bg-background text-foreground border-border` | `text-muted-foreground` |

Follow the surrounding component's vocabulary. Both resolve through the shared stylesheet; neither requires a second set of light and dark classes at every call site. [Colours](/docs/foundations/colors) maps common tokens to their uses.

When extending the token set, define the light and dark values together. Check the actual foreground/background pairing, including hover, disabled, error, and focus states. A semantic name does not by itself prove sufficient contrast.

## Apply a host accent

`AccentColorProvider` supplies a runtime accent to components that opt into it, including route-tab indicators and selected sub-panel rows:

```tsx
import { AccentColorProvider } from '@tale/ui/accent-color';

<AccentColorProvider accentColor="#056CFF">
  {children}
</AccentColorProvider>;
```

This is a composition excerpt: the host supplies `children` and a validated color. Without the provider, participating components use their default treatment. The context does not recolor every component or replace all theme tokens; for example, `Tabs` uses its stylesheet classes directly.

Keep organization lookup and branding policy in the service. Review an accent on both themes before using it for a meaningful indicator.

## Keep browser assets in sync

`ThemeAssets`, mounted inside the theme tree, updates the favicon and theme-color metadata to match an explicit theme choice. Your HTML must provide the elements it updates: `favicon-light`, `favicon-dark`, `theme-color`, and `theme-color-dark`.

If the page changes theme but its browser tab icon does not, inspect those IDs and the asset URLs. If only part of a page changes, look for hardcoded colors or an extra theme provider. Use the [accessibility checks](/docs/foundations/accessibility) to verify contrast and reduced-motion behavior in the rendered page.
