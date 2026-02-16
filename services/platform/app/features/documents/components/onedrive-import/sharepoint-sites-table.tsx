'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

import type { SharePointSite } from './types';

import { getPathFromUrl } from './types';

interface SharePointSitesTableProps {
  sites: SharePointSite[];
  isLoading: boolean;
  onSiteClick: (site: SharePointSite) => void;
}

export function SharePointSitesTable({
  sites,
  isLoading,
  onSiteClick,
}: SharePointSitesTableProps) {
  const { t } = useT('documents');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<SharePointSite>[]>(
    () => [
      {
        id: 'name',
        header: tTables('headers.name'),
        cell: ({ row }) => {
          const site = row.original;
          return (
            <HStack gap={3}>
              <div className="flex size-8 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/30">
                <SharePointIcon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground cursor-pointer truncate font-medium hover:text-blue-600">
                  {site.displayName}
                </div>
                {site.description && (
                  <div className="text-muted-foreground max-w-md truncate text-xs">
                    {site.description}
                  </div>
                )}
              </div>
            </HStack>
          );
        },
      },
      {
        id: 'url',
        header: () => (
          <div className="text-right">{t('microsoft365.siteUrl')}</div>
        ),
        cell: ({ row }) => (
          <div
            className="text-muted-foreground max-w-[200px] truncate text-right text-sm"
            title={row.original.webUrl}
          >
            {getPathFromUrl(row.original.webUrl)}
          </div>
        ),
      },
    ],
    [tTables, t],
  );

  if (isLoading) {
    return <DataTableSkeleton columns={columns} rows={5} />;
  }

  if (!sites || sites.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-center">
        <SharePointIcon className="mb-4 size-12 opacity-50" />
        <h3 className="text-foreground mb-2 text-lg font-medium">
          {t('microsoft365.noSites')}
        </h3>
        <p className="text-muted-foreground max-w-md text-sm">
          {t('microsoft365.noSitesDescription')}
        </p>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={sites}
      getRowId={(row) => row.id}
      onRowClick={(row) => onSiteClick(row.original)}
    />
  );
}
