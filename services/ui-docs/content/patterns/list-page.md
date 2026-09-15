---
title: List page
description: Build a collection screen with one create action, connected search, and honest loading and empty states.
---

A list page helps someone find an item, inspect it, or create another. Start with one page title and a `DataTable` that owns the collection toolbar. Keep data access, permissions, and filter state in your service.

## Inspect the composition

<Demo name="patterns/list-page" />

This frame is an inert layout illustration. The header contains the title; the table toolbar contains search and the create action. For a working search interaction, use the [Data table example](/docs/components/data-table).

The following excerpt assumes the host supplies columns, filtered rows, query state, and `openCreate`:

```tsx
<PageLayout
  header={
    <AdaptiveHeaderRoot showBorder>
      <AdaptiveHeaderTitle>Automations</AdaptiveHeaderTitle>
    </AdaptiveHeaderRoot>
  }
>
  <ContentArea>
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      caption="Automations"
      search={{ value: query, onChange: setQuery }}
      addAction={{ label: 'New automation', onClick: openCreate }}
      emptyState={{ title: 'No automations yet' }}
    />
  </ContentArea>
</PageLayout>
```

Import these components from their `@tale/ui` subpaths and mount the [adaptive header context and mobile slot](/docs/components/app-shell) in the surrounding application. This fragment is the page body, not a complete app entry point.

## Connect the controls to one data source

The search field and filters describe the rows beneath them. Update the query in their handlers, then filter the complete local dataset or request filtered results from the backend. Reset page or cursor state when the query changes so a new search does not start halfway through the old result set.

Use `filters`, `dateRange`, and `onClearFilters` for the shared facet controls. Put additional filter-side content in `filtersContent`. Keep shareable filter state in the URL when reloads and copied links should preserve the view.

`addAction` creates the primary toolbar affordance; it does not open a dialog by itself. Supply `onClick`, `href`, or menu items and derive availability from the host's permission state. Do not duplicate the same create action in the page header.

## Separate no data, no matches, and a failed request

| State | What to communicate |
| --- | --- |
| Initial request pending | A loading skeleton, using `isLoading` and a meaningful `approxRowCount`. |
| Collection has no items | `emptyState` explaining the collection and how to create the first item. |
| Active search has no matches | The table's shared no-results state; preserve a way to clear the query. |
| More cursor pages could contain matches | Continue loading; do not claim the entire collection has no results yet. |
| Request failed | `error` plus `onRetry`, preserving the reader's query. |

An unknown approximate count is `undefined`, not zero. Positive counts reserve skeleton rows up to the component cap. A create action moves into the initial empty state only when no search/filter toolbar needs to remain visible.

## Make each row usable

Choose stable IDs with `getRowId`. Use a named link or action for the item's destination, even if `onRowClick` also makes pointer navigation convenient. Keep selection checkboxes, expansion, menus, and row navigation distinct, and check that activating one does not trigger another.

`isRowClickable` excludes rows that should not navigate. `onRowMouseEnter` can preload a destination, but the click handler still needs to work when there was no hover, including keyboard and touch use.

## Choose paging and prove the states

Use client-side pagination only when the full set is present. For server pages, pass the one-based page and paging callbacks. For cursor sources, append batches through `infiniteScroll` and supply accurate `hasMore` and loading state. Provide singular and plural `entityLabel` values for count copy.

Before shipping, try an initially empty collection, a nonmatching search, a rejected request followed by Retry, and a narrow viewport. Tab to the search, a row action, and the create control. Confirm the host prevents unauthorized writes even if its UI state is bypassed.
