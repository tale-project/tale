---
title: List page
description: The most common screen in the product — page chrome, a create action, and a searchable table.
---

Most of the platform is list pages: agents, automations, projects, members,
connectors. They are all the same composition, and following it is what makes
them feel like one product rather than five.

By the end of this page you will be able to build a list page whose header,
create action, search and empty state sit where a reader already expects them.

## The whole thing

<Demo name="patterns/list-page" />

## The composition

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
      caption="Automations"
      search={{ value: query, onChange: setQuery }}
      addAction={{ label: 'New automation', onClick: openCreate }}
      emptyState={{ title: 'No automations yet', description: '…' }}
    />
  </ContentArea>
</PageLayout>
```

Four decisions are already made for you:

1. **The title is the page's `h1`**, rendered by the header row — never by the
   body.
2. **The create action belongs to the table**, through `addAction`. That is
   what keeps it at the same size and in the same place on every list, and what
   lets the table move it into the empty state when there is nothing to show.
3. **Search lives in the table's header bar**, not above it. A filter bar
   outside its table never receives the table's disabled or loading signal, so
   it goes on offering filters for a list that is not there.
4. **The empty state is part of the table**, so "no rows" and "no matches"
   render in the same place with different copy.

## Filtering

`filters` renders facets through the shared filter panel, and `onClearFilters`
renders the affordance that resets them. Keep the filter state in the URL — a
filtered list should survive a reload and be sendable as a link.

There is exactly one filter panel in the system. If you are about to build
facet UI, search for the existing one first.

## Loading

Give the table `isLoading` **and** `approxRowCount`. The second one decides the
skeleton: `undefined` while the count is still loading, `0` when no rows are
expected so the empty state shows immediately, and a positive number to reserve
that many rows so the page does not jump when the data arrives.

## Rows that lead somewhere

For a row that opens a detail page, use `onRowClick` plus `onRowMouseEnter` to
preload the route, so the detail is already warm by the time the pointer
arrives. Gate clickability with `isRowClickable` when some rows are not
navigable — an aggregate row, or one the reader may not open.

## Paging

Pick one model and stay with it on a given screen:

- **`pagination`** when the total is known and the reader may want to jump.
- **`infiniteScroll`** when the source is cursor-based. Pass `entityLabel` as
  `{ one, other }` so the footer count reads correctly for a single row.

## What to avoid

- A create button in the header row **and** `addAction` — the reader sees two
  primary actions.
- A page title in the body as well as the header, which produces two `h1`s.
- A hand-rolled empty state next to the table rather than inside it.
- A search box that filters a different list than the one below it.

## Where to go next

[Settings page](/docs/patterns/settings-page) is the other half of the
product's surface area.
