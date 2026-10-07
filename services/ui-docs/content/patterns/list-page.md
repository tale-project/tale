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

A short viewport is the one exception, and it is built in: under 30rem of height (the `short-viewport:` variant — a phone held sideways, a laptop zoomed to 200 %) the chrome would leave the bounded frame a sliver, so the variant lets the frame grow with its rows, the page scrolls instead, and the page header scrolls away with it. An infinite list follows on its own: it watches the page scroll there rather than the table's. Nothing to write — but don't bound a collection screen any other way, or it loses this.

Content the page stacks above the table — a folder breadcrumb, a load-failure alert — is a sibling inside the same `ContentArea`, so it keeps the page inset and the table keeps the remaining height. Tables embedded in a scrolling settings page are the exception: they are not collection screens and take neither the variant nor the flag.

## Connect the controls to one data source

The search field and filters describe the rows beneath them. `useListPage` keeps them honest: it matches the query against the complete set — draining a paginated source first, so a match on a page that has not loaded yet is still found — and starts its window over when the query changes, so a new search never opens halfway through the old result. Search `fields` name the row's own keys, or pass an accessor for a value the row does not carry, such as a label your service translates.

For server-paginated search, use `search: { value, onChange, serverSide: true }` and send the debounced value to your query. The server must apply the search across the collection and return matching cursor pages. This opt-in avoids the client completeness drain, including while the query is debouncing; ordinary controlled searches retain their existing drain behavior. Managed client filters and client-side sorts still drain for completeness.

For a bounded sorted window, pass the same `sortingColumns` and `sorting` that the table uses. The hook runs TanStack's complete column-aware model before slicing, including accessors, custom comparators and multiple sort keys. Set the table's `sorting.manual` to `true` to preserve that preordered window rather than re-sorting it independently. Without `sortingColumns`, the existing complete-sort path remains unchanged. Small sorted buffers below five pages are shown whole; larger buffers use the normal display window, which expands on scroll. This bounds the initial sort render. In its normal sticky layout, the table also limits mounted rows as the loaded collection grows.

A facet that matches one field exactly can live in the hook through `filters.definitions`. Facets your service keeps itself — in the URL, say, or with several values at once — go to the hook as `filters.configs` with an `onClear`, and the rows you hand it are the ones those facets leave. Use `dateRange` and `filtersContent` on the table for the rest. Keep shareable filter state in the URL when reloads and copied links should preserve the view.

`addAction` creates the primary toolbar affordance; it does not open a dialog by itself. Supply `onClick`, `href`, or menu items and derive availability from the host's permission state. Do not duplicate the same create action in the page header.

## Separate no data, no matches, and a failed request

| State | What to communicate |
| --- | --- |
| Initial request pending | A loading skeleton, using `isLoading` and a meaningful `approxRowCount`. |
| Collection has no items | `emptyState` explaining the collection and how to create the first item. |
| Active search has no matches | The table's shared no-results state; preserve a way to clear the query. |
| More cursor pages could contain matches | Continue loading; do not claim the entire collection has no results yet. |
| Request failed | `error` plus `onRetry`, preserving the reader's query. `useListPage` derives both from the data source's `error` and `retry`: hand it the query's error once the retry policy gave up, and the table shows the error state instead of the collection's empty state. Rows already loaded stay on screen through a failed refetch; name that failure above the table with `CatalogLoadError` from `@tale/ui/catalog/catalog-view` and the same retry, marked `isRetrying` while it runs. Give it a new `failureKey` for each failure, so a repeated failure is announced again while **Try again** keeps its node and any focus on it, and an `onFocusLost` target for the focus it holds when a refresh that worked takes it away. Pass the same target as the table's `onErrorFocusLost`: with nothing loaded, a refresh the reader did not start swaps the error state for the loading state. A paginated source that failed on a later page stops loading until the retry, and the table says the rest could not be loaded. A host that lists rows of its own beside the source's, or narrows them itself, passes `loadFailed` to say the rows are partial, as a documents table does for folders shown beside a documents read that never answered. Pass `error` only when nothing at all is loaded. While `loadFailed` holds, the rows stay through a retry instead of giving way to a first-load skeleton. Every loaded row the search and filters keep also stays on screen, even after a search or its clearing resets the page window. |

An unknown approximate count is `undefined`, not zero. Positive counts reserve skeleton rows up to the component cap. A create action moves into the initial empty state only when no search/filter toolbar needs to remain visible.

## Make each row usable

Choose stable IDs with `getRowId`. Use a named link or action for the item's destination, even if `onRowClick` also makes pointer navigation convenient. Keep selection checkboxes, expansion, menus, and row navigation distinct, and check that activating one does not trigger another.

`isRowClickable` excludes rows that should not navigate. `onRowMouseEnter` can preload a destination, but the click handler still needs to work when there was no hover, including keyboard and touch use.

## Bound a custom collection's rendering

<Demo name="patterns/large-list" />

Scroll this 5,000-item collection or activate **Scroll to last item**, then select **Item 5000**. All items remain available while the DOM contains only rows near the viewport and any focused row. Tab and Shift+Tab retain the focused row's immediate neighbours.

Use `useVirtualList` from `@tale/ui/use-virtual-list` when a collection needs its own rows instead of `DataTable`. Give it a bounded scroll container, stable item keys, the full filtered count, and an estimated row height. Attach `measureElement` and `data-index` to each rendered row so taller content updates the scroll extent. Render `paddingBefore` and `paddingAfter` as hidden spacers in normal flow; this leaves transforms available for drag-and-drop. Pass spacing through `gap` rather than adding a CSS gap between the spacers and rows.

The hook renders collections of 100 rows or fewer in full by default. `threshold` and `overscan` let the host tune that boundary and the surrounding rendered rows. Use `scrollToIndex` for a destination that may be unmounted. When a child borrows an ancestor's scroll ref, wait for the returned `scrollElement` before an initial scroll or offset measurement. A collection beneath earlier content in the same scroller also supplies `scrollMargin` and updates it when that content changes height.

Attach the hook's `onFocusCapture` and `onBlurCapture` to each measured row so focus inside a portaled row control keeps its owning row mounted. Keep draft state outside rows that may unmount, or pass their indices through `pinnedIndices` while editing or dragging. A popup opened without focus or a dirty editor that no longer has focus needs an explicit pin. Search, sorting, permissions, and loading still operate on the host's full collection. Native reversed chat scrollers and expanding tables need their own layout treatment.

## Choose paging and prove the states

Every collection screen pages the same way, whatever its source: `useListPage` hands the table a window of rows, loads more as the reader nears the end, and closes the frame on the count footer — "Showing all 12 automations", or "3 of 12" while a search narrows the set. Pass `{ type: 'query', data }` for a set that arrives whole and `{ type: 'paginated', … }` for cursor pages with their status and `loadMore`. Provide singular and plural `entityLabel` values for the footer's copy. Rows that aggregate several entities, such as a folder, can report how many they stand for through `countRow`.

Pass `windowKey` when a service changes the collection or applies its own search and facets. A changed key restarts the display window; live updates under the same key preserve the rows already revealed. If a deep link selects a row outside that window, pass that row as `revealedRow`. The hook includes it once, in collection order, without mounting all the rows before it. The row must belong to the processed collection; search and filters still apply, and scrolling eventually fills the intervening rows.

Before shipping, try an initially empty collection, a nonmatching search, a rejected request followed by Retry, and a narrow viewport. Tab to the search, a row action, and the create control. Confirm the host prevents unauthorized writes even if its UI state is bypassed.
