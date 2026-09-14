---
title: Icons
description: Use consistent Lucide glyphs, supply accessible names, and preserve usable pointer targets.
---

Use Lucide for interface glyphs and the package's existing custom marks for supported brands. Choose the icon from the action's meaning, then decide whether it supplements visible text or carries the whole label.

## Choose the icon size

<Demo name="foundations/icons" />

| Class | Typical use |
| --- | --- |
| `size-3` | Small inline metadata. |
| `size-4` | Standard button, row, and navigation icons. |
| `size-5` | A more prominent standalone control or status. |
| `size-6` | A feature or empty-state glyph. |

Lucide's normal stroke is the starting point. `Button.icon` uses `size-4`; `IconButton` accepts `iconSize={3 | 4 | 5 | 6}` and defaults to 4. Changing the glyph size does not change the button's pointer target.

## Hide decoration, name controls

```tsx
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Download, Search } from 'lucide-react';

export function FileActions() {
  return (
    <div className="flex gap-2">
      <Button type="button" icon={Download}>Export</Button>
      <IconButton type="button" icon={Search} aria-label="Search files" />
    </div>
  );
}
```

The Export icon is decorative because the visible text already names the action. Button hides that icon from assistive technology. The search control has no visible text, so its `aria-label` supplies the name and the shared IconButton uses that label for its tooltip.

`IconButton` requires `aria-label` at the type level. An icon-sized `Button` accepts `aria-label` or `title`; in that specific case, `title` supplies both an accessible name and tooltip. A generic Tooltip only supplies a description. Do not rely on its text to name an otherwise unnamed button.

For a stateful action, name the next action or communicate the current state clearly. A changed glyph alone may be ambiguous; use appropriate state attributes such as `aria-pressed` where the control is a toggle.

## Reuse custom brand marks

```tsx
import { IconButton } from '@tale/ui/icon-button';
import { GithubIcon } from '@tale/ui/icons/github';

export function SourceLink() {
  return (
    <IconButton
      icon={GithubIcon}
      aria-label="Source on GitHub"
      asChild
      slotChild={<a href="https://github.com/tale-project/tale" />}
    />
  );
}
```

The package exposes GitHub, Claude, Google, Microsoft, Gmail, Google Drive, OneDrive, Outlook, SharePoint, Shopify, website, enter-key, and locale-flag marks through its exported icon paths. Check `packages/ui/package.json` for the exact subpath; names such as `github` and `google-drive-icon` are not uniform enough to guess safely.

Before drawing a new mark, search the package and Lucide. A new shared icon should match the existing prop/ref convention, carry no embedded screen-specific label, and be tested at its intended sizes.

## Keep the target larger than the glyph

An IconButton is 36px square by default or 32px with `size="sm"`. Keep that hit area even when the glyph is only 12px. On touch-heavy layouts, favor additional space around important actions and inspect neighboring targets for accidental activation.

WCAG 2.2 AA [Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) uses 24×24 CSS pixels with specified exceptions. WCAG 2.1's [Target Size criterion](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) is the 44×44 AAA criterion. These are different requirements; do not cite the latter as a 24px rule.

Check focus visibility in both themes and verify that an icon inside an overlay does not make Escape or focus restoration confusing. [Accessibility](/docs/foundations/accessibility) covers the full page review.
