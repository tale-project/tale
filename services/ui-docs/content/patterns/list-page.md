---
title: List page
description: Build a collection screen with one create action, connected search, and honest loading and empty states.
---

A list page helps someone find an item, inspect it, or create another. Start with one page title and a `DataTable` that owns the collection toolbar. Keep data access, permissions, and filter state in your service.

## Inspect the composition

<Demo name="patterns/list-page" />

This frame is an inert layout illustration. The header contains the title; the table toolbar contains search and the create action. For a working search interaction, use the [Data table example](/docs/components/data-table).

The following excerpt assumes the host supplies `columns`, the loaded `rows` (`undefined` while the first request is pending), and `openCreate`:

```tsx
const list = useListPage({
  dataSource: { type: 'query', data: rows },
  pageSize: DEFAULT_LIST_PAGE_SIZE,
  search: { fields: ['name'], placeholder: 'Search automations' },
  getRowId: (row) => row.id,
  entityLabel: { one: 'automation', other: 'automations' },
});

return (
  <PageLayout
    header={
      <AdaptiveHeaderRoot showBorder>
        <AdaptiveHeaderTitle>Automations</AdaptiveHeaderTitle>
      </AdaptiveHeaderRoot>
    }
  >
    <ContentArea variant="list">
      <DataTable
        stickyLayout
        {...list.tableProps}
        columns={columns}
        caption="Automations"
        addAction={{ label: 'New automation', onClick: openCreate }}
        emptyState={{ title: 'No automations yet' }}
      />
    </ContentArea>
  </PageLayout>
);
```

Import these components from their `@tale/ui` subpaths — `useListPage` and `DEFAULT_LIST_PAGE_SIZE` come from `@tale/ui/use-list-page` — and mount the [adaptive header context and mobile slot](/docs/components/app-shell) in the surrounding application. This fragment is the page body, not a complete app entry point.

## Scroll the rows, not the page

`ContentArea variant="list"` and `DataTable stickyLayout` are one decision, not two options. The variant bounds the body against the page shell; the table then takes that bound and puts its own scrollport around the rows, so the toolbar, the header row and the count footer stay where the reader left them. Write both on every collection screen.

Omit either and the table grows to its content and the page scroller moves instead: search and the create action scroll off the top, and two collection screens in the same product start behaving differently. A short list is unaffected — the frame hugs its rows rather than stretching to fill the viewport. A screen that is nothing but its table, with no content below it, can ask for the other behaviour with [`fillHeight`](/docs/components/data-table).

Content the page stacks above the table — a folder breadcrumb, a load-failure alert — is a sibling inside the same `ContentArea`, so it keeps the page inset and the table keeps the remaining height. Tables embedded in a scrolling settings page are the exception: they are not collection screens and take neither the variant nor the flag.

## Connect the controls to one data source

The search field and filters describe the rows beneath them. `useListPage` keeps them honest: it matches the query against the complete set — draining a paginated source first, so a match on a page that has not loaded yet is still found — and starts its window over when the query changes, so a new search never opens halfway through the old result. Search `fields` name the row's own keys, or pass an accessor for a value the row does not carry, such as a label your service translates.

A facet that matches one field exactly can live in the hook through `filters.definitions`. Facets your service keeps itself — in the URL, say, or with several values at once — go to the hook as `filters.configs` with an `onClear`, and the rows you hand it are the ones those facets leave. Use `dateRange` and `filtersContent` on the table for the rest. Keep shareable filter state in the URL when reloads and copied links should preserve the view.

`addAction` creates the primary toolbar affordance; it does not open a dialog by itself. Supply `onClick`, `href`, or menu items and derive availability from the host's permission state. Do not duplicate the same create action in the page header.

## Separate no data, no matches, and a failed request

| State | What to communicate |
| --- | --- |
| Initial request pending | A loading skeleton, using `isLoading` and a meaningful `approxRowCount`. |
| Collection has no items | `emptyState` explaining the collection and how to create the first item. |
| Active search has no matches | The table's shared no-results state; preserve a way to clear the query. |
| More cursor pages could contain matches | Continue loading; do not claim the entire collection has no results yet. |
| Request failed | `error` plus `onRetry`, preserving the reader's query. `useListPage` derives both from the data source's `error` and `retry`: hand it the query's error once the retry policy gave up, and the table shows the error state instead of the collection's empty state; rows already loaded stay on screen through a failed refetch. |

An unknown approximate count is `undefined`, not zero. Positive counts reserve skeleton rows up to the component cap. A create action moves into the initial empty state only when no search/filter toolbar needs to remain visible.

## Make each row usable

Choose stable IDs with `getRowId`. Use a named link or action for the item's destination, even if `onRowClick` also makes pointer navigation convenient. Keep selection checkboxes, expansion, menus, and row navigation distinct, and check that activating one does not trigger another.

`isRowClickable` excludes rows that should not navigate. `onRowMouseEnter` can preload a destination, but the click handler still needs to work when there was no hover, including keyboard and touch use.

## Choose paging and prove the states

Every collection screen pages the same way, whatever its source: `useListPage` hands the table a window of rows, loads more as the reader nears the end, and closes the frame on the count footer — "Showing all 12 automations", or "3 of 12" while a search narrows the set. Pass `{ type: 'query', data }` for a set that arrives whole and `{ type: 'paginated', … }` for cursor pages with their status and `loadMore`. Provide singular and plural `entityLabel` values for the footer's copy. Rows that aggregate several entities, such as a folder, can report how many they stand for through `countRow`.

Before shipping, try an initially empty collection, a nonmatching search, a rejected request followed by Retry, and a narrow viewport. Tab to the search, a row action, and the create control. Confirm the host prevents unauthorized writes even if its UI state is bypassed.
