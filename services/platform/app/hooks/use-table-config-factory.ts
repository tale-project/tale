'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Doc, TableNames } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type { Namespace } from '@/lib/i18n/types';
import * as columnBuilders from '@/app/components/ui/data-table/column-builders';

type TranslationFn = (key: string) => string;

interface TableConfigMetadata {
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
  defaultSort: string;
  defaultSortDesc: boolean;
  infiniteScroll: boolean;
}

interface TableConfig<TData> extends TableConfigMetadata {
  columns: ColumnDef<TData>[];
}

interface CreateTableConfigOptions<TTableName extends TableNames> {
  /** Translation namespace for entity-specific translations */
  entityNamespace: Namespace;
  /** Additional translation namespaces (e.g., ['common']) */
  additionalNamespaces?: Namespace[];
  /** Default sort field */
  defaultSort: keyof Doc<TTableName> | (string & {});
  /** Sort descending by default (default: true) */
  defaultSortDesc?: boolean;
  /** Page size (default: 10) */
  pageSize?: number;
  /** Enable sticky layout (default: true) */
  stickyLayout?: boolean;
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
 * @example
 * ```tsx
 * export const useCustomersTableConfig = createTableConfigHook<'customers'>(
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
export function createTableConfigHook<TTableName extends TableNames>(
  options: CreateTableConfigOptions<TTableName>,
  columnsBuilder: ColumnsBuilder<Doc<TTableName>>,
): () => TableConfig<Doc<TTableName>> {
  const {
    entityNamespace,
    additionalNamespaces = [],
    defaultSort,
    defaultSortDesc = true,
    pageSize = 10,
    stickyLayout = true,
    infiniteScroll = true,
  } = options;

  return function useTableConfig(): TableConfig<Doc<TTableName>> {
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
      stickyLayout,
      pageSize,
      defaultSort: defaultSort as string,
      defaultSortDesc,
      infiniteScroll,
    };
  };
}

export type { TableConfig, CreateTableConfigOptions, ColumnBuilderContext };
