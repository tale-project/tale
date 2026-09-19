'use client';

import * as columnBuilders from '@tale/ui/data-table/column-builders';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import type { Namespace } from '@/lib/i18n/types';

type TranslationFn = (key: string) => string;

/**
 * Default first-page size for entity list tables. Exported so route loaders can
 * prime the paginated cache with the same count the table renders.
 */
export const DEFAULT_TABLE_PAGE_SIZE = 20;

interface TableConfigMetadata {
  searchPlaceholder: string;
  pageSize: number;
  defaultSort: string;
  defaultSortDesc: boolean;
  infiniteScroll: boolean;
}

interface TableConfig<TData> extends TableConfigMetadata {
  columns: ColumnDef<TData>[];
}

interface CreateTableConfigOptions<TRow> {
  /** Translation namespace for entity-specific translations */
  entityNamespace: Namespace;
  /** Additional translation namespaces (e.g., ['common']) */
  additionalNamespaces?: Namespace[];
  /** Default sort field */
  defaultSort: keyof TRow | (string & {});
  /** Sort descending by default (default: true) */
  defaultSortDesc?: boolean;
  /** Page size (default: {@link DEFAULT_TABLE_PAGE_SIZE}) */
  pageSize?: number;
  /** Enable infinite scroll (default: true) */
  infiniteScroll?: boolean;
}

interface ColumnBuilderContext {
  /** Translation function for 'tables' namespace */
  tTables: TranslationFn;
  /** Translation function for entity-specific namespace */
  tEntity: TranslationFn;
  /** Additional translation functions keyed by namespace */
  t: Record<string, TranslationFn>;
  /** Pre-built column builders */
  builders: typeof columnBuilders;
}

type ColumnsBuilder<TData> = (ctx: ColumnBuilderContext) => ColumnDef<TData>[];

/**
 * Factory function to create table configuration hooks.
 *
 * Reduces boilerplate by providing:
 * - Automatic translation hook setup
 * - Pre-built column builders for common patterns
 * - Consistent return type structure
 *
 * How the table SCROLLS is not configured here. Every overview list — the
 * Knowledge tables, Automations and Projects — is a fixed frame: the page
 * renders `<ContentArea variant="list">` and the table takes the bare
 * `stickyLayout` flag, so the contract reads the same at all of them and an
 * entity cannot opt one list out of it by hand.
 *
 * @example
 * ```tsx
 * export const useCustomersTableConfig = createTableConfigHook<CustomerDoc>(
 *   {
 *     entityNamespace: 'customers',
 *     defaultSort: '_creationTime',
 *   },
 *   ({ tTables, tEntity, builders }) => [
 *     {
 *       accessorKey: 'name',
 *       header: tTables('headers.name'),
 *       size: 278,
 *       cell: ({ row }) => <NameCell name={row.original.name} />,
 *     },
 *     builders.createSourceColumn(tTables),
 *     builders.createLocaleColumn(),
 *     builders.createCreationTimeColumn(tTables),
 *     builders.createActionsColumn(CustomerRowActions, 'customer'),
 *   ],
 * );
 * ```
 */
export function createTableConfigHook<TRow>(
  options: CreateTableConfigOptions<TRow>,
  columnsBuilder: ColumnsBuilder<TRow>,
): () => TableConfig<TRow> {
  const {
    entityNamespace,
    additionalNamespaces = [],
    defaultSort,
    defaultSortDesc = true,
    pageSize = DEFAULT_TABLE_PAGE_SIZE,
    infiniteScroll = true,
  } = options;

  return function useTableConfig(): TableConfig<TRow> {
    const { t: tTables } = useT('tables');
    const { t: tEntity } = useT(entityNamespace);

    const t0 = useT(additionalNamespaces[0] ?? 'common');
    const t1 = useT(additionalNamespaces[1] ?? 'common');
    const t2 = useT(additionalNamespaces[2] ?? 'common');

    const extraTranslations = useMemo(() => {
      const result: Record<string, TranslationFn> = {};
      if (additionalNamespaces[0]) result[additionalNamespaces[0]] = t0.t;
      if (additionalNamespaces[1]) result[additionalNamespaces[1]] = t1.t;
      if (additionalNamespaces[2]) result[additionalNamespaces[2]] = t2.t;
      return result;
    }, [t0.t, t1.t, t2.t]);

    const columns = useMemo(
      () =>
        columnsBuilder({
          tTables,
          tEntity,
          t: extraTranslations,
          builders: columnBuilders,
        }),
      [tTables, tEntity, extraTranslations],
    );

    return {
      columns,
      searchPlaceholder: tEntity('searchPlaceholder'),
      pageSize,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keyof TRow is always string here; narrowing for the TableConfig interface
      defaultSort: defaultSort as string,
      defaultSortDesc,
      infiniteScroll,
    };
  };
}

export type { TableConfig, CreateTableConfigOptions };
