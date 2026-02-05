'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { ComponentType } from 'react';
import { HStack } from '@/app/components/ui/layout/layout';
import { LocaleIcon } from '@/app/components/icons/locale-icon';
import {
  TableTimestampCell,
  TableDateCell,
} from '@/app/components/ui/data-display/table-date-cell';
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

  const codePoints = [...countryCode.toUpperCase()].map(
    (char) => 127397 + char.charCodeAt(0)
  );
  return String.fromCodePoint(...codePoints);
}

type TranslationFn = (key: string) => string;

interface ActionsColumnOptions {
  size?: number;
  headerLabel?: string;
}

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
    size: options?.size ?? 140,
    meta: { isAction: true },
    cell: ({ row }) => (
      <HStack justify="end">
        <ActionsComponent {...{ [entityPropName]: row.original } as { [K in TPropName]: TData }} />
      </HStack>
    ),
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
>(tTables: TranslationFn, options?: CreationTimeColumnOptions): ColumnDef<TData> {
  return {
    accessorKey: '_creationTime',
    header: () => (
      <span className="text-right w-full block">
        {tTables('headers.created')}
      </span>
    ),
    size: options?.size ?? 140,
    cell: ({ row }) => (
      <TableTimestampCell timestamp={row.original._creationTime} preset="short" />
    ),
  };
}

/**
 * Creates a date column for custom date fields.
 *
 * @example
 * ```tsx
 * createDateColumn('lastUpdated', 'headers.updated', tTables, { alignRight: true })
 * ```
 */
export function createDateColumn<TData, K extends keyof TData>(
  accessorKey: K,
  headerKey: string,
  tTables: TranslationFn,
  options?: DateColumnOptions,
): ColumnDef<TData> {
  const alignRight = options?.alignRight ?? false;

  return {
    accessorKey: accessorKey as string,
    header: alignRight
      ? () => (
          <span className="text-right w-full block">{tTables(headerKey)}</span>
        )
      : () => tTables(headerKey),
    size: options?.size ?? 140,
    cell: ({ row }) => (
      <TableDateCell
        date={row.original[accessorKey] as unknown as number | Date | string}
        preset={options?.preset ?? 'short'}
        alignRight={alignRight}
        className="text-xs"
      />
    ),
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
    header: () => tTables('headers.source'),
    size: options?.size ?? 140,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.source
          ? startCase(row.original.source.toLowerCase())
          : tTables('cells.unknown')}
      </span>
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
    header: () => <LocaleIcon className="size-4 text-muted-foreground" />,
    size: options?.size ?? 100,
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
    accessorKey: accessorKey as string,
    header: () => tTables(headerKey),
    size: options?.size,
    cell: ({ row }) => {
      const value = row.original[accessorKey];
      const text = value ? String(value) : (options?.emptyText ?? '-');
      return (
        <span
          className={
            options?.className ??
            `text-xs text-muted-foreground ${options?.truncate ? 'truncate max-w-sm block' : ''}`
          }
        >
          {text}
        </span>
      );
    },
  };
}
