---
title: Introduction
description: Choose the Tale UI package for your screen and find a working example to build from.
---

Use `@tale/ui` to build application screens: forms, tables, dialogs, navigation, and the providers behind them. Use `@tale/marketing-ui` for public websites: page sections, calls to action, site navigation, and product illustrations. The marketing package builds on the application package, so you install both when building a marketing site.

## Start with your task

| You want to… | Start here |
| --- | --- |
| Render your first Tale component | [Installation](/docs/getting-started/installation) |
| Add an action or edit a value | [Button](/docs/components/button) and [Input](/docs/components/input) |
| Build a searchable collection | [Data table](/docs/components/data-table), then [List page](/docs/patterns/list-page) |
| Build configuration with Save and Discard | [Settings page](/docs/patterns/settings-page) |
| Add dark mode or translate component labels | [Theming](/docs/getting-started/theming) and [Internationalization](/docs/getting-started/i18n) |
| Build a public product page | [Marketing UI](/docs/marketing-ui/overview) |

## Choose the package by the screen's purpose

Application screens favor compact controls, readable status, and predictable placement for repeated tasks. Marketing pages use larger headings, wider sections, and pill-shaped calls to action. This site's documentation uses the application components; its [home page](/) uses marketing components.

| Package | Typical building blocks | Stylesheet |
| --- | --- | --- |
| `@tale/ui` | `Button`, `Input`, `DataTable`, `Dialog`, `PageLayout` | `@tale/ui/globals.css` |
| `@tale/marketing-ui` | `MarketingButton`, `SectionHeading`, feature sections, `DemoShell` | `@tale/marketing-ui/globals.css` |

The marketing stylesheet imports the application stylesheet. Load the stylesheet for your site once; you do not need both imports.

Both packages ship TypeScript source. Import documented package subpaths, such as `@tale/ui/button`, rather than reaching into another workspace's `src` directory. The package's `exports` map defines which paths consumers can use.

## Use the examples

Each **Live example** renders package components. Choose **Code** to inspect the source for that example, and **Hide code** to close it. You can change inputs, open dialogs, and switch tabs without connecting a Tale backend.

Examples demonstrate UI behavior with local sample data. They do not send invitations, connect providers, or save organization settings. Page-layout and marketing-window examples are labelled illustrations: their contents are deliberately inert so a second application header and its controls do not enter the page's keyboard or screen-reader navigation. Use the linked component examples for interaction.

The guides and examples are currently in English. The packages support translated interface text; [Internationalization](/docs/getting-started/i18n) explains how to supply it in your application.

## Keep business rules in the service

The shared package owns reusable presentation and interaction. Your service owns authorization, network requests, validation rules specific to its domain, and persistence.

For example, `DataTable` displays the rows you pass; it does not fetch organization members. `ConfirmDialog` asks for a decision; your callback decides whether and how to delete a record. Pass screen-specific titles and labels as props. Shared labels such as a dialog's close control come from the package catalog.

Before introducing a new component, check the existing exports and [composition patterns](/docs/patterns/list-page). A service wrapper around a shared component is the appropriate place for a backend query or permission check.
