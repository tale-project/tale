---
title: Tabs and navigation
description: Choose local panels or route navigation, preserve drafts deliberately, and keep every destination reachable.
---

Use `Tabs` to switch panels within a screen. Use `TabNavigation` for destinations that should support a URL, reload, and browser history. Similar visual treatments do not make these controls interchangeable.

```tsx
import { Tabs } from '@tale/ui/tabs';
import { TabNavigation } from '@tale/ui/tab-navigation';
```

## Switch local panels

<Demo name="tabs/underline" />

Choose **Skills** or **Runs**. The visible panel changes without a URL change. Focus a tab and use the arrow keys to move through the strip. The Radix-based component supplies tab roles and panel associations.

Each item has a stable `value`, a `label`, and optional `content`. Use `defaultValue` for local state, or `value` and `onValueChange` when the host controls the selection. Supply an initial selection explicitly; do not assume the first item becomes selected automatically.

The `underline` variant suits a section strip. The default `pill` variant suits a smaller switch inside a panel:

<Demo name="tabs/pill" />

## Preserve panel state intentionally

Inactive panel content unmounts by default. Returning to a panel can therefore reset its local form or expanded state. Set `keepMounted` to retain the mounted panels and hide inactive ones instead.

Mounted hidden content can still run hooks and subscriptions. Use this option when state should survive, and make loading or polling rules explicit in the panel. If the draft must survive route changes or reloads too, keep it in a host-owned store or persistence layer; `keepMounted` only addresses tab-panel mounting.

| `Tabs` prop | Default and purpose |
| --- | --- |
| `items` | Required `TabItem[]`: `value`, `label`, optional `content`, `disabled`, `ariaLabel`. |
| `variant` | `pill`; alternatively `underline`. |
| `value`, `defaultValue`, `onValueChange` | Controlled state or initial local selection. |
| `listAriaLabel` | Accessible name for the tab list. |
| `equalWidth` | `false`; distributes items across the available list width. |
| `actions`, `toolbar` | Trailing controls or a separate row beneath the strip. |
| `overflowMenu` | `false`; folds tabs that no longer fit into a menu when enabled. |
| `overflowMenuLabel` | Defaults to `More`; pass a localized label in translated screens. |
| `keepMounted` | `false`; retains hidden panel content when enabled. |
| `className`, `listClassName`, `triggerClassName` | Targeted layout customization. |

## Navigate between routes

`TabNavigation` requires TanStack Router context. Its items carry `label` and `href`, and the component reads the current location. Supply resolved URLs: unlike `LinkButton`, an item has no separate `params` prop to fill a `$id` placeholder.

This composition excerpt assumes your application defines the listed routes and supplies `projectId`:

```tsx
<TabNavigation
  ariaLabel="Project sections"
  items={[
    { label: 'Overview', href: `/projects/${projectId}`, matchMode: 'exact' },
    { label: 'Files', href: `/projects/${projectId}/files` },
    { label: 'Tasks', href: `/projects/${projectId}/tasks` },
  ]}
/>
```

The default `matchMode` is `startsWith`; choose `exact` for an overview route that would otherwise also match its children. `additionalActivePaths` keeps an item active for related sibling routes. `isActive` overrides path matching, useful when several views share a pathname and differ by a search parameter.

| `TabNavigation` option | Behavior |
| --- | --- |
| `search` on an item | Search parameters passed with that destination. |
| `disabled` on an item | Keeps the label visible without navigation. |
| `trailing` on an item | Optional badge or other supporting content. |
| `prefetch` | Defaults to `true`; preloads on intent. |
| `standalone` | Defaults to `true`; set `false` inside an existing `StickyHeader`. |
| `overflow` | Defaults to `scroll`; `menu` folds the trailing destinations into a menu. |
| `dirtyKeys` | A `ReadonlySet<string>` from the editor, intersected with each item's `dirtyKeys` array to show an unsaved-change dot. |

## Check navigation on a narrow screen

Do not assume a route strip always becomes a dropdown on mobile: horizontal scrolling is the default. Select `overflow="menu"` when a growing list of destinations needs a menu. Trailing route-strip actions move to the mobile floating-action area below `md`; leave room for that area in the content layout.

Name local tab lists with `listAriaLabel` and route landmarks with `ariaLabel`. Name icon-only local tabs with the item's `ariaLabel`. The active route uses `aria-current`, while a local selected tab uses `aria-selected`. Route tabs can use the host accent context; local `Tabs` uses its own theme classes.

Use a [settings-page editor](/docs/patterns/settings-page) to protect drafts when leaving a route. A dirty dot communicates state but does not block navigation by itself.
