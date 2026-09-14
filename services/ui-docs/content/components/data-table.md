---
title: Data table
description: The list surface — columns, search, filters, the create action and the empty state, in one component.
---

`DataTable` is not a styled `<table>`. It owns the whole list surface: the
header bar with search and filters, the rows, the empty state, pagination or
infinite scroll, selection, and the create action. That is deliberate — a list
page assembled from separate pieces drifts, and in this system every list looks
and behaves the same.

By the end of this page you will be able to render a table with columns you
define, wire a search box, and know which prop owns which part of the chrome.

```tsx
import { DataTable } from '@tale/ui/data-table/data-table';
import type { ColumnDef } from '@tale/ui/data-table/data-table-types';
```

## A table with columns

<Demo name="data-table/basic" />

Columns are TanStack Table `ColumnDef`s. `caption` is the accessible name of
the table and is required for a screen reader to announce what it is reading.

For the common column shapes there are builders in
`@tale/ui/data-table/column-builders` — `createTextColumn`, `createDateColumn`,
`createCreationTimeColumn`, `createSelectColumn`, `createActionsColumn` — so a
date renders the same way in every table.

## Search, and an empty state that is honest

<Demo name="data-table/with-search" />

`search` renders the header's search box; you own the value and the filtering,
because only the caller knows whether the query goes to memory or to a backend.

`emptyState` takes a `title` and optional `description`, `icon` and `action`.
When the table is empty **and** has no search or filter chrome, `DataTable`
moves `addAction` into the empty state, so the create button sits with the
copy explaining the emptiness instead of floating above an empty grid.

Type a query that matches nothing in the example above to see it.

## The header bar

| Prop | What it renders |
| --- | --- |
| `search` | The search box — `{ value, onChange, placeholder }` |
| `filters` | Facet filters, through the shared filter panel |
| `dateRange` | A date-range picker with presets |
| `onClearFilters` | The "clear" affordance beside the filters |
| `addAction` | The primary create button, at a fixed size and placement |
| `actionMenu` | An escape hatch for bespoke header content |

Prefer `addAction` over `actionMenu` for the standard "Add X" button — that is
what keeps the create affordance in the same place on every list page in the
product.

## Rows

| Prop | Type | Notes |
| --- | --- | --- |
| `columns` | `ColumnDef<TData, TValue>[]` | Required |
| `data` | `TData[]` | Required |
| `caption` | `string` | The table's accessible name |
| `getRowId` | `(row: TData) => string` | Needed for selection and expansion |
| `onRowClick` | `(row: Row<TData>) => void` | Whole-row navigation |
| `isRowClickable` | `(row: Row<TData>) => boolean` | Per-row guard for the above |
| `rowClassName` | `string \| (row) => string` | |
| `enableRowSelection` | `boolean \| (row) => boolean` | The function form gates per row |
| `rowSelection` / `onRowSelectionChange` | controlled state | |
| `enableExpanding` + `renderExpandedRow` | | Inline detail panel |
| `onRowMouseEnter` | `(row: Row<TData>) => void` | Use with route preloading |

## Loading and paging

`isLoading` renders skeleton rows. `approxRowCount` tells the table **how
many** — `undefined` means the count is still loading, `0` means no data is
expected and the empty state shows immediately, and a positive number sets the
skeleton row count so the page does not jump when the data lands.

Choose one paging model:

- **`pagination`** — page numbers. Pass `clientSide` when the whole set is
  already in memory.
- **`infiniteScroll`** — cursor-based. `{ hasMore, onLoadMore, isLoadingMore }`
  plus an `entityLabel` for the footer count. Pass `entityLabel` as
  `{ one, other }` so a single-row table reads correctly.

## Accessibility

- `caption` is not optional in practice. Without it the table has no accessible
  name, and a reader arrives at a grid of unexplained cells.
- Every header cell renders real `<th>` text. A header that is only an icon
  reads as an empty column to a screen reader.
- Row selection uses real checkboxes with names, not click targets.
- Sorting controls are buttons inside the header cell, reachable by Tab.

## When to use something else

| Instead of | Use |
| --- | --- |
| A short static list with no chrome | `Table` from `@tale/ui/table` |
| A grid of cards | `catalog/catalog-grid` and friends |
| Two or three key/value rows | `LabeledValue` or `SectionRow` |

## Where to go next

[List page](/docs/patterns/list-page) puts this table inside the page chrome it
is designed for.
