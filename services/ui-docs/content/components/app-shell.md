---
title: App shell
description: Mount application providers once, then compose a page header, content area, and responsive navigation.
---

`AppShell` provides the shared theme, translation, and tooltip context. It does not draw your page header or navigation. Compose those separately with `PageLayout`, the adaptive header components, and `ContentArea`.

## Mount the providers

[Installation](/docs/getting-started/installation) includes a complete entry point. A router-based application uses this composition:

```tsx
import { AppShell } from '@tale/ui/app-shell';
import { RouterProvider } from '@tanstack/react-router';

// i18n and router are initialized by the host application.
<AppShell i18n={i18n} locale={{ mode: 'client' }} theme>
  <RouterProvider router={router} />
</AppShell>;
```

| Option | What it adds |
| --- | --- |
| `i18n` | Required service instance, supplied to `I18nextProvider`. |
| `locale={{ mode: 'client' }}` | Preference/browser locale detection and synchronization. `onChange` can load additional locale data; `defaultLocale` supplies a fallback. |
| `theme` | The shared theme provider with the normal system-preference behavior. |
| `children` | Your router or application content. |

The full optional stack is ThemeProvider, TooltipProvider, LocaleProvider, I18nextProvider, then locale synchronization and content. Do not add a TooltipProvider around each button; the outer provider shares tooltip timing across controls.

For a URL-driven locale, omit `locale` and synchronize the route's language through `LocaleSync`. Query clients, authentication, authorization, branding, and a toast viewport remain host responsibilities. `AppShell` imports the shared Inter fonts.

## Compose the page

<Demo name="app-shell/page-layout" />

This is a labelled layout illustration. Its nested application header and controls are inert; inspect **Code** to see how the pieces compose without adding a second accessible application to this page.

| Piece | Responsibility |
| --- | --- |
| `PageLayout` | Flex page and scroll container; wraps an optional `header` in `StickyHeader`. |
| `AdaptiveHeaderRoot` | The title/action row, with optional border and responsive treatment. |
| `AdaptiveHeaderTitle` | The page title, rendered as `h1`. |
| `ContentArea` | Content spacing and width: `page`, `narrow`, or `panel`. |

Give flex ancestors a usable height and `min-h-0` when the page should scroll inside them. `PageLayout` reserves scrollbar space to reduce sideways movement as row counts change. `ContentArea` includes clearance for mobile floating actions.

Choose one divider between header and content. Use `showBorder` for a plain header; avoid adding another border when a tab strip already supplies the divider.

## Plan the mobile header

Adaptive headers coordinate through `AdaptiveHeaderProvider`. The desktop root alone is not a complete mobile header: the host must render the receiving `AdaptiveHeaderSlot` in its mobile chrome. The mobile treatment removes the desktop title from the accessibility tree and presents the active title through that slot.

Check a real phone-width page after composing the providers and slots. It should have one accessible `h1`, visible actions, and enough bottom clearance for any floating action bar. A desktop layout illustration cannot prove this integration for your service.

## Add breadcrumbs

<Demo name="app-shell/breadcrumbs" />

`HeaderBreadcrumbs` renders a labelled navigation list whose leaf is the current page's `h1`. Supply ancestor links or buttons through the crumb content and use `HEADER_CRUMB_LINK_CLASS` for their shared treatment. The component does not resolve application routes for you.

Below `md`, the trail collapses toward an immediate-parent back control. `showImmediateParentOnMobile` can preserve the parent's visible name where there is room. Long titles still need testing in the full header, including the action buttons beside them.

## Add a section rail

`SubPanel` provides the bordered secondary navigation surface. The default width is 224px; `wide` is 256px. It is hidden below `md`, so the host needs a mobile navigation path, such as a labelled drawer.

```tsx
import { SubPanel } from '@tale/ui/sub-panel';
import { SubPanelRowLink, SubPanelSectionHeader } from '@tale/ui/sub-panel-list';
```

The caller supplies rows and scrolling. Use `SubPanelRowLink` for destinations and `SubPanelSectionHeader` for groups. For a custom row, reuse `SUB_PANEL_ROW_CLASS` and `useSubPanelRowTreatment` rather than reproducing selection styles.

Start the application with a `SkipLink` targeting `<main id="main" tabIndex={-1}>`. Name each navigation landmark. Scrolling a rail to its active row should not steal the reader's initial keyboard position. Use the [list-page](/docs/patterns/list-page) or [settings-page](/docs/patterns/settings-page) pattern for the content inside this shell.
