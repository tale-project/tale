---
title: App shell
description: The providers every Tale frontend mounts, and the chrome pieces a page is assembled from.
---

"App shell" is two things: the provider stack that wraps the whole app, and the
chrome components a single page is built from. Both are in `@tale/ui`, and both
are why two screens written by two people end up looking like one product.

By the end of this page you will know what `AppShell` mounts and in what order,
and how a page assembles its header, its body and its breadcrumb trail.

## The provider stack

```tsx
import { AppShell } from '@tale/ui/app-shell';

<AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
  <RouterProvider router={router} />
</AppShell>;
```

The order it mounts is load-bearing:

```
<ThemeProvider> → <TooltipProvider> → <LocaleProvider> →
  <I18nextProvider> → <LocaleSync> → children
```

`I18nextProvider` contains a bridge that reads `useLocale()`, so
`LocaleProvider` has to sit above it. One `TooltipProvider` wraps everything so
the skip-delay works across a whole toolbar — nesting a second one resets the
timer and every tip re-waits.

| Prop | Type | Notes |
| --- | --- | --- |
| `i18n` | `i18n` | The instance from `initServiceI18n` |
| `locale` | `{ mode: 'client', onChange?, defaultLocale? }` | Omit for a URL-driven site |
| `theme` | `boolean \| { defaultTheme }` | `theme` alone mounts the `'system'` default |

Omit `locale` when the language comes from the URL; mount `<LocaleSync>` from
your root route instead. Omit `theme` only when the service deliberately never
toggles `.dark`.

`AppShell` is also where the Inter webfont is imported, so a service that
skips it renders in the fallback face.

Query clients, auth, branding and the router are **not** bundled, because they
vary per service. Outer providers wrap `AppShell`; inner ones nest between it
and the router.

## A page

<Demo name="app-shell/page-layout" />

Three pieces:

- **`PageLayout`** is the scroll container. It takes an optional `header`,
  wraps it in a `StickyHeader`, and reserves the scrollbar's width so filtering
  a list does not shift the page sideways.
- **`AdaptiveHeaderRoot`** is the `h-13` title row. `AdaptiveHeaderTitle`
  renders the page's only `h1` inside it. `showBorder` draws the section
  divider — pass it unless a tab strip directly below carries its own border,
  because a header ends in exactly one line.
- **`ContentArea`** is the body measure: `page` for a list, `narrow`
  (`max-w-3xl`) for configuration, `panel` for a side panel.

On a phone the desktop header is hidden and its content is mirrored through
`AdaptiveHeaderSlot`, which is why the root marks itself `aria-hidden` there —
exactly one `h1` stays in the accessibility tree either way.

## Breadcrumbs

<Demo name="app-shell/breadcrumbs" />

`HeaderBreadcrumbs` is a semantic `nav > ol` whose **leaf is the page's `h1`**,
carrying `aria-current="page"`. Ancestor crumbs are yours to render — pass a
`Link` or a `button` carrying `HEADER_CRUMB_LINK_CLASS` — so the component
stays router-agnostic while every trail styles identically.

Below `md` the full trail is too wide, so it collapses to an icon-only back
button pointing at the immediate parent. Pass
`showImmediateParentOnMobile` when the parent's name is worth the width.

## The side panel

`SubPanel` is the second-level rail a section mounts beside its content — the
settings rail and the chat panel are the two in the product, and the navigation
rail on this site is a third. It is a fixed width (`default` 224px, `wide`
256px), `bg-background`, right-bordered, and hidden below `md`.

Its rows come from `sub-panel-list`: `SubPanelSectionHeader` for a group label,
`SubPanelRowLink` for a leaf, and `SUB_PANEL_ROW_CLASS` +
`useSubPanelRowTreatment` when a row needs more than a path — which is how the
rail on the left of this page is built.

```tsx
import { SubPanel } from '@tale/ui/sub-panel';
import {
  SubPanelRowLink,
  SubPanelSectionHeader,
} from '@tale/ui/sub-panel-list';
```

Content and scrolling stay with the caller: pass a scrollable child rather than
an overflowing panel.

## Accessibility

- One `h1` per page, rendered by the header — not by the body.
- The header ends in exactly one `border-border` line.
- Name every landmark: `SubPanel` takes `ariaLabel`, `HeaderBreadcrumbs` takes
  `ariaLabel`, and a page with two `nav`s needs both.
- Start the page with a `SkipLink` pointing at `<main id="main">`.

## Where to go next

[List page](/docs/patterns/list-page) and
[Settings page](/docs/patterns/settings-page) are these pieces assembled into
the two screens the product has most of.
