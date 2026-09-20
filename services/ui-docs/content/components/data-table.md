---
title: Data table
description: Connect rows, search, selection, loading, and paging to one consistent list surface.
---

`DataTable` renders a table and its surrounding search, filters, create action, and paging controls. You provide the data and state transitions. The component does not fetch rows, authorize actions, or filter a backend query for you.

```tsx
import { DataTable } from '@tale/ui/data-table/data-table';
import type { ColumnDef } from '@tanstack/react-table';
```

## Define the visible columns

<Demo name="data-table/basic" />

Each TanStack `ColumnDef` supplies an accessor or cell renderer and a header. Use a stable domain ID through `getRowId` when rows can be selected, expanded, reordered, or refreshed. Otherwise row-index identity can attach state to the wrong item after a data change.

Pass a descriptive `caption`, such as **Agents in this workspace**. It becomes a screen-reader table caption. It is optional in the TypeScript interface, but a data table still needs an accessible name in the page.

The builders exported from `@tale/ui/data-table/column-builders` include text, date, creation-time, selection, and action columns. Reuse them for those common shapes; use custom cells when the content requires them.

## Lead the row with a name and a glyph

<Demo name="data-table/icon-cell" />

`TableIconCell` from `@tale/ui/data-table/table-icon-cell` is the first column of an entity list: a glyph in a muted tile, then the name. Pass the icon bare — a Lucide icon, an Iconify `<Icon>`, a `ConfigIcon`. The tile sets its size and colour, so one collection screen cannot drift from the next, and a row keeps the same height whatever glyph it carries.

`badges` places chips beside the name; they hold their width while the label truncates. `caption` adds a second line for an address the reader needs next to the name, such as an automation's slug. Leave it off for a single-line row.

Pair the column with `tableIconCellSkeleton()` — `{ lines: 2 }` when the cell renders a caption. It reserves the tile's footprint rather than the skeleton's bare-icon default, so rows do not jump when the data arrives.

## Wire search to the rows

<Demo name="data-table/with-search" />

Activate **Search automations**, then type `Weekly`: only **Weekly digest** remains. Type a value that matches nothing to see the shared **No results found** state. Clear the query to restore all four rows. The example filters names in memory; it does not search the trigger column.

`search={{ value, onChange, placeholder }}` renders and controls the search field. Your callback updates the query and the rows. For a backend search, send the new query to the backend, reset the paging cursor, and pass the resulting rows back to the table. Preserve meaningful query/filter state in the URL when the screen needs shareable results.

`emptyState` describes an initially empty collection. An active query or filter with zero rows uses the table's shared no-results copy instead. If cursor pages remain, the table treats zero visible matches as still loading rather than declaring the entire source empty.

## Choose toolbar controls

| Prop | Host responsibility |
| --- | --- |
| `search` | Own the query and apply it to the data source. |
| `filters`, `dateRange` | Supply available choices, selected values, and handlers. |
| `onClearFilters` | Reset the relevant filters consistently. |
| `filtersContent` | Place an additional filter-side control inside the toolbar. |
| `addAction` | Supply a label and a click handler, destination, or create-menu items. |
| `actionMenu` | Supply bespoke primary-side toolbar content; it takes precedence over `addAction`. |

When an initially empty table has no search/filter toolbar, `addAction` moves into the empty state. With toolbar controls present, it stays in the header. Pass the permission-dependent disabled state from your service; the table does not decide access.

When a `DataTableActionMenu` item opens a dialog, pass a stable button ref as `triggerRef` and pass the same ref to the dialog's `restoreFocusRef`. The menu item disappears when the dialog opens; the toolbar button remains the keyboard user's return point after closing it.

## Decide what scrolls

`stickyLayout` turns the table into a fixed frame: the toolbar, the header row and the footer hold their place while the rows scroll in the table's own scrollport. It measures itself against its parent, so it needs a bounded one — `ContentArea variant="list"` on a collection screen. Without that bound the frame collapses.

Leave it off for a table embedded in a page that scrolls as a whole, such as a section of a settings page. Every collection screen takes it; see the [list-page pattern](/docs/patterns/list-page).

## Loading and errors

Set `isLoading` while fetching the initial data. `approxRowCount` helps reserve space: an unknown count gives the default skeleton; a positive estimate gives skeleton rows up to the component's cap; zero allows the supplied initial empty state. Do not pass zero merely because a request has not returned yet.

Pass `error` and `onRetry` for a failed query. A load failure should explain recovery rather than masquerade as an empty collection. Keep filter state when retrying so the request still matches what the reader sees.

## Pick one paging model

| Model | Configuration |
| --- | --- |
| All rows already loaded | `pagination.clientSide: true`; the table slices the in-memory data. |
| Server pages | Supply `pagination` callbacks/counts and the one-based `currentPage`; replace rows after each request. |
| Cursor loading | Supply `infiniteScroll.hasMore`, `onLoadMore`, and loading state; append returned rows in the host. |

Cursor loading is automatic by default and also provides a load-more control. Supply `entityLabel: { one, other }` for count-aware footer text. `totalCount` is the unfiltered total; `displayedCount` is useful when one visible row represents multiple entities. Do not report an estimate as an exact total.

## Selection, sorting, and row actions

`enableRowSelection` accepts a boolean or a per-row predicate. Pair controlled `rowSelection` with `onRowSelectionChange`, a stable `getRowId`, and a selection column. A disabled UI row is not a server-side permission boundary.

The `sorting` configuration enables sorting and carries `initialSorting` with `onSortingChange`. Verify whether your host is sorting the complete local set or requesting a sorted backend set; sorting only the currently loaded page is not a global ordering.

`onRowClick` receives a TanStack `Row`, so domain data is in `row.original`. `isRowClickable` can exclude aggregate or restricted rows. Keep a named keyboard-accessible link or action in the row; a pointer click handler alone is not equivalent to a navigation link. Use `onRowMouseEnter` for optional route preloading.

`enableExpanding` and `renderExpandedRow` reveal inline detail. Keep the expansion control distinct from row navigation and test both with the keyboard. For the surrounding screen, use the [list-page pattern](/docs/patterns/list-page); for a short static table without this chrome, use `Table` from `@tale/ui/table`.
