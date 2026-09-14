---
title: Tabs and navigation
description: Two tab components with different jobs — one switches panels in place, the other switches routes.
---

The system has two tab surfaces, and picking the wrong one is a routing bug
rather than a styling one. `Tabs` switches panels **inside** a page and keeps
the URL where it is. `TabNavigation` switches **routes** and reads the active
tab from the current location.

By the end of this page you will know which one a given strip is, and how each
behaves when the strip runs out of room.

```tsx
import { Tabs } from '@tale/ui/tabs';
import { TabNavigation } from '@tale/ui/tab-navigation';
```

## `Tabs` — panels in place

<Demo name="tabs/underline" />

`items` carries the whole strip: each entry is a `value`, a `label` and the
`content` that belongs to it. The component owns the roving focus, the
`aria-controls` wiring and the active indicator.

The `underline` variant is the page-level strip. `pill` is the inset one, for a
segmented switch inside a panel:

<Demo name="tabs/pill" />

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `items` | `TabItem[]` | — | `{ value, label, content?, disabled?, ariaLabel? }` |
| `value` / `defaultValue` | `string` | — | Controlled or uncontrolled |
| `onValueChange` | `(value: string) => void` | — | |
| `variant` | `'pill' \| 'underline'` | `'pill'` | |
| `equalWidth` | `boolean` | `false` | Divide the strip evenly |
| `actions` | `ReactNode` | — | Trailing slot on the tab row |
| `toolbar` | `ReactNode` | — | A row under the strip |
| `listAriaLabel` | `string` | — | Names the tablist |
| `overflowMenu` | `boolean` | — | Collapse overflowing tabs into a menu |
| `keepMounted` | `boolean` | `false` | Keep inactive panels in the DOM |

Reach for `keepMounted` when a panel holds expensive state — a half-filled
form, a scrolled list — that should survive a round trip to another tab.

## `TabNavigation` — routes

`TabNavigation` takes `items` of `{ label, href }` and renders router links. It
decides which tab is active by matching the current pathname, so the browser's
back button, a deep link and a reload all agree with the strip.

```tsx
<TabNavigation
  ariaLabel="Project"
  items={[
    { label: 'Overview', href: '/projects/$id' },
    { label: 'Files', href: '/projects/$id/files' },
    { label: 'Automations', href: '/projects/$id/automations' },
  ]}
/>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `items` | `TabNavigationItem[]` | `{ label, href, matchMode?, search?, isActive?, disabled?, trailing? }` |
| `matchMode` | `'exact' \| 'startsWith'` | Default for every item |
| `ariaLabel` | `string` | Names the navigation landmark |
| `prefetch` | `boolean` | Preload on intent; on by default |
| `standalone` | `boolean` | `false` when nested inside a `StickyHeader` |
| `dirtyKeys` | `readonly string[]` | Surfaces an unsaved-changes dot on a tab |

Two matching escapes exist for real routes that do not nest cleanly:
`additionalActivePaths` keeps a tab lit on a sibling sub-view, and `isActive`
overrides matching outright — which is what a strip that switches on a search
param rather than a path needs.

On a narrow viewport the strip collapses into a dropdown rather than scrolling
sideways, so no tab becomes unreachable.

## Accessibility

- `Tabs` renders a real `tablist` / `tab` / `tabpanel` set: arrow keys move
  between tabs, Tab moves into the panel.
- `TabNavigation` is a `nav` landmark full of links, not tabs — because
  activating one navigates. Give it an `ariaLabel` so a page with several
  landmarks stays legible.
- Name the strip in both cases: `listAriaLabel` for `Tabs`, `ariaLabel` for
  `TabNavigation`.
- The active indicator is tinted by the host accent colour when an
  `AccentColorProvider` is mounted, and neutral otherwise — never by colour
  alone, since the active tab also carries `aria-selected` or `aria-current`.

## When to use something else

| Instead of | Use |
| --- | --- |
| Two mutually exclusive modes of one control | `SegmentedControl` |
| Sections a reader can open several of | `Accordion` |
| A whole-page rail of destinations | `SubPanel` plus the sub-panel list |
| A phone's primary navigation | `BottomTabBar` |

## Where to go next

[App shell](/docs/components/app-shell) is where a tab strip actually sits —
under the header row, above the content area.
