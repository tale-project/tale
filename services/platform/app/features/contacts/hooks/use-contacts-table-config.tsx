'use client';

import { Text } from '@tale/ui/text';
import type { Column } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';

import { ContactRowActions } from '../components/contact-row-actions';

type Contact = ContactDoc;

interface SortLabels {
  ascending: string;
  descending: string;
  available: string;
}

/**
 * Clickable column header that toggles TanStack Table's built-in sorting —
 * "just enable sorting via the existing column config API" (#2639): no new
 * table-level affordance, the column's own `header` render does the work.
 * The visible label carries the sort icon; the current state is announced
 * to assistive tech via a trailing `sr-only` suffix rather than relying on
 * icon shape alone.
 */
function sortableHeader<TData>(
  label: string,
  sortLabels: SortLabels,
  // The "Added" column right-aligns its (date) cells — the header must match
  // or the column reads misaligned against its own data.
  align: 'start' | 'end' = 'start',
) {
  return ({ column }: { column: Column<TData> }) => {
    const sorted = column.getIsSorted();
    const Icon =
      sorted === 'asc'
        ? ArrowUp
        : sorted === 'desc'
          ? ArrowDown
          : ChevronsUpDown;
    const stateLabel =
      sorted === 'asc'
        ? sortLabels.ascending
        : sorted === 'desc'
          ? sortLabels.descending
          : sortLabels.available;

    return (
      <button
        type="button"
        className={`text-fg-base hover:text-fg-base focus-visible:ring-ring inline-flex w-full items-center gap-1 rounded px-2 py-1 font-medium focus-visible:ring-1 focus-visible:outline-none ${
          align === 'end' ? '-mr-2 justify-end' : '-ml-2 justify-start'
        }`}
        onClick={column.getToggleSortingHandler()}
      >
        <span>{label}</span>
        <Icon className="text-muted-foreground size-3.5" aria-hidden="true" />
        <span className="sr-only">, {stateLabel}</span>
      </button>
    );
  };
}

export const useContactsTableConfig = createTableConfigHook<ContactDoc>(
  {
    entityNamespace: 'contacts',
    defaultSort: '_creationTime',
    additionalNamespaces: ['common'],
  },
  ({ tTables, tEntity, t, builders }) => {
    const sortLabels: SortLabels = {
      ascending: t.common('aria.sortAscending'),
      descending: t.common('aria.sortDescending'),
      available: t.common('aria.sortAvailable'),
    };

    return [
      builders.createSelectColumn(),
      {
        accessorKey: 'name',
        header: sortableHeader<Contact>(tTables('headers.name'), sortLabels),
        size: 200,
        // `block truncate`: a long value (contacts frequently carry an email as
        // their name) is an unbreakable token that, as a bare inline span in a
        // `table-fixed` cell, overflows the column and bleeds over the next one.
        // `truncate` only clips once the span is block-level with the cell's
        // width — matches every sibling entity table. Full value is on the row's
        // detail dialog.
        cell: ({ row }) => (
          <Text as="span" variant="label" truncate className="block">
            {row.original.name || ''}
          </Text>
        ),
      },
      {
        accessorKey: 'email',
        header: sortableHeader<Contact>(tTables('headers.email'), sortLabels),
        size: 240,
        cell: ({ row }) => (
          <Text as="span" variant="body" truncate className="block">
            {row.original.email || tTables('cells.noEmail')}
          </Text>
        ),
      },
      {
        // `tables` has no phone header; the contacts namespace owns the label.
        accessorKey: 'phone',
        header: tEntity('phone'),
        size: 160,
        enableSorting: false,
        cell: ({ row }) => (
          <Text as="span" variant="body" truncate className="block">
            {row.original.phone || ''}
          </Text>
        ),
      },
      { ...builders.createSourceColumn(tTables), enableSorting: false },
      { ...builders.createLocaleColumn(), enableSorting: false },
      builders.createCreationTimeColumn(tTables, {
        header: sortableHeader<Contact>(
          tTables('headers.created'),
          sortLabels,
          'end',
        ),
      }),
      builders.createActionsColumn(ContactRowActions, 'contact', {
        size: 56,
        headerLabel: tTables('headers.actions'),
      }),
    ];
  },
);
