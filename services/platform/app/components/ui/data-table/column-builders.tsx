'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import type { ComponentType } from 'react';

import { LocaleIcon } from '@/app/components/icons/locale-icon';
import {
  TableTimestampCell,
  TableDateCell,
} from '@/app/components/ui/data-display/table-date-cell';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { i18n } from '@/lib/i18n/i18n';
import { startCase } from '@/lib/utils/string';

const DEFAULT_LANGUAGE_TO_COUNTRY: Record<string, string> = {
  en: 'US',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  pt: 'PT',
  nl: 'NL',
  zh: 'CN',
};

function getCountryFlag(locale: string): string {
  let countryCode: string | undefined;

  try {
    const parsed = new Intl.Locale(locale);
    countryCode = parsed.region;
  } catch {
    // Invalid locale string, continue with fallback
  }

  if (!countryCode) {
    const lang = locale.toLowerCase().slice(0, 2);
    countryCode = DEFAULT_LANGUAGE_TO_COUNTRY[lang] || lang.toUpperCase();
  }

  if (countryCode.length !== 2) return locale;

  const codePoints = Array.from(countryCode.toUpperCase()).map(
    (char) => 127397 + char.charCodeAt(0),
  );
  return String.fromCodePoint(...codePoints);
}

type TranslationFn = (key: string) => string;

interface ActionsColumnOptions {
  size?: number;
  headerLabel?: string;
}

/**
 * Canonical width for the row-actions column. Sized for a single icon-only
 * `MoreVertical` trigger (the `EntityRowActions` shape every table should
 * use). Locked across tables so the 3-dot column lands at the exact same
 * x-offset whether you're looking at customers, vendors, teams, or any
 * future entity list — visual rhythm across the dashboard depends on it.
 *
 * Override only when a row genuinely needs an in-line button cluster (rare
 * — collapse into the dropdown instead), and document the reason in code.
 */
export const ACTIONS_COLUMN_SIZE = 56;

/**
 * Canonical width for the multi-select column. Mirrors the actions column's
 * `ACTIONS_COLUMN_SIZE` purpose on the opposite side of the row: a single
 * 24px Checkbox centered in a 40px column. See `createSelectColumn`.
 */
export const SELECT_COLUMN_SIZE = 40;

interface CreationTimeColumnOptions {
  size?: number;
}

interface DateColumnOptions {
  size?: number;
  alignRight?: boolean;
  preset?: 'short' | 'long' | 'relative' | 'time' | 'medium';
}

interface SourceColumnOptions {
  size?: number;
}

interface LocaleColumnOptions {
  size?: number;
}

interface TextColumnOptions {
  size?: number;
  className?: string;
  emptyText?: string;
  truncate?: boolean;
}

/**
 * Creates the standard actions column for row actions.
 *
 * Pin this last in your `columns` array so the 3-dot trigger sits at the
 * row's right edge consistently across every table. The default width is
 * `ACTIONS_COLUMN_SIZE` — don't override unless you genuinely have more
 * than a single dropdown trigger (in which case, prefer collapsing the
 * cluster into the dropdown instead).
 *
 * @example
 * ```tsx
 * createActionsColumn(CustomerRowActions, 'customer')
 * ```
 */
export function createActionsColumn<TData, TPropName extends string>(
  ActionsComponent: ComponentType<{ [K in TPropName]: TData }>,
  entityPropName: TPropName,
  options?: ActionsColumnOptions,
): ColumnDef<TData> {
  return {
    id: 'actions',
    header: options?.headerLabel
      ? () => <span className="sr-only">{options.headerLabel}</span>
      : undefined,
    size: options?.size ?? ACTIONS_COLUMN_SIZE,
    meta: { isAction: true },
    cell: ({ row }) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Computed property key loses type narrowing
      const props = { [entityPropName]: row.original } as {
        [K in TPropName]: TData;
      };
      return (
        <HStack justify="end">
          <ActionsComponent {...props} />
        </HStack>
      );
    },
  };
}

/**
 * Creates a timestamp column using _creationTime (Convex standard field).
 *
 * @example
 * ```tsx
 * createCreationTimeColumn(tTables)
 * ```
 */
export function createCreationTimeColumn<
  TData extends { _creationTime: number },
>(
  tTables: TranslationFn,
  options?: CreationTimeColumnOptions,
): ColumnDef<TData> {
  return {
    accessorKey: '_creationTime',
    header: () => (
      <span className="block w-full text-right">
        {tTables('headers.created')}
      </span>
    ),
    size: options?.size ?? 140,
    // Right-aligned short date → skeleton renders a narrow right-aligned bar
    // that matches the cell instead of a full-width text bar.
    meta: { headerLabel: tTables('headers.created'), align: 'right' },
    cell: ({ row }) => (
      <TableTimestampCell
        timestamp={row.original._creationTime}
        preset="short"
      />
    ),
  };
}

/**
 * Creates a date column for custom date fields.
 *
 * @example
 * ```tsx
 * createDateColumn('lastUpdated', 'headers.updated', tTables)
 * ```
 */
export function createDateColumn<TData, K extends keyof TData>(
  accessorKey: K,
  headerKey: string,
  tTables: TranslationFn,
  options?: DateColumnOptions,
): ColumnDef<TData> {
  const alignRight = options?.alignRight ?? true;

  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef requires string accessorKey; K is already keyof TData
    accessorKey: accessorKey as string & keyof TData,
    header: alignRight
      ? () => (
          <span className="block w-full text-right">{tTables(headerKey)}</span>
        )
      : tTables(headerKey),
    size: options?.size ?? 140,
    meta: {
      headerLabel: tTables(headerKey),
      align: alignRight ? 'right' : undefined,
    },
    cell: ({ row }) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- date column accessor value is always a date-compatible type
      const date = row.original[accessorKey] as number | Date | string;
      return (
        <TableDateCell
          date={date}
          preset={options?.preset ?? 'short'}
          alignRight={alignRight}
        />
      );
    },
  };
}

/**
 * Creates a source column showing the data source with proper casing.
 *
 * @example
 * ```tsx
 * createSourceColumn(tTables)
 * ```
 */
export function createSourceColumn<TData extends { source?: string | null }>(
  tTables: TranslationFn,
  options?: SourceColumnOptions,
): ColumnDef<TData> {
  return {
    accessorKey: 'source',
    header: tTables('headers.source'),
    size: options?.size ?? 140,
    cell: ({ row }) => (
      <Text as="span" variant="caption">
        {row.original.source
          ? startCase(row.original.source.toLowerCase())
          : tTables('cells.unknown')}
      </Text>
    ),
  };
}

/**
 * Creates a locale column with an icon header and flag emoji display.
 *
 * @example
 * ```tsx
 * createLocaleColumn()
 * ```
 */
export function createLocaleColumn<TData extends { locale?: string | null }>(
  options?: LocaleColumnOptions,
): ColumnDef<TData> {
  return {
    accessorKey: 'locale',
    header: () => <LocaleIcon className="text-muted-foreground size-4" />,
    size: options?.size ?? 100,
    // A single flag glyph — center a small bar rather than a full-width one.
    meta: { align: 'center' },
    cell: ({ row }) => {
      const locale = row.original.locale || 'en';
      const flag = getCountryFlag(locale);
      return <span className="text-base">{flag}</span>;
    },
  };
}

/**
 * Creates a simple text column.
 *
 * @example
 * ```tsx
 * createTextColumn('description', 'headers.description', tTables, { truncate: true })
 * ```
 */
export function createTextColumn<TData, K extends keyof TData>(
  accessorKey: K,
  headerKey: string,
  tTables: TranslationFn,
  options?: TextColumnOptions,
): ColumnDef<TData> {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ColumnDef requires string accessorKey; K is already keyof TData
    accessorKey: accessorKey as string & keyof TData,
    header: tTables(headerKey),
    size: options?.size,
    cell: ({ row }) => {
      const value = row.original[accessorKey];
      const text = value ? String(value) : (options?.emptyText ?? '-');
      return (
        <Text
          as="span"
          variant="caption"
          className={
            options?.className ??
            (options?.truncate ? 'block max-w-sm truncate' : undefined)
          }
        >
          {text}
        </Text>
      );
    },
  };
}

/**
 * Creates a checkbox column for row selection.
 *
 * @example
 * ```tsx
 * createSelectColumn<Product>()
 * ```
 */
export function createSelectColumn<TData>(): ColumnDef<TData> {
  return {
    id: 'select',
    size: SELECT_COLUMN_SIZE,
    // Cells with multi-line content (avatar + name + caption) make the row
    // taller than the checkbox's intrinsic height. `TableCell` does set
    // `vertical-align: middle`, but the checkbox is `inline-flex` and ends up
    // sitting on the first text line. Wrapping in `flex h-full items-center`
    // anchors the checkbox to the row's true vertical center, matching the
    // column text alongside it. `justify-center` keeps it centered within the
    // 40px column width.
    header: ({ table }) => (
      <div className="flex h-full items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={i18n.t('common:aria.selectAll')}
        />
      </div>
    ),
    // Non-selectable rows (e.g. protected agents gated out by the table's
    // `enableRowSelection` predicate) render no checkbox at all — an inert
    // "Select row" control is a false affordance and a confusing AT target.
    cell: ({ row }) =>
      row.getCanSelect() ? (
        <div className="flex h-full items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
            aria-label={i18n.t('common:aria.selectRow')}
          />
        </div>
      ) : null,
    meta: { skeleton: { type: 'checkbox' } },
  };
}
