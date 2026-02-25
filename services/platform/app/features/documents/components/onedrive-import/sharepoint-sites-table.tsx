'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { HStack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
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
                  <Text
                    as="div"
                    variant="caption"
                    truncate
                    className="max-w-md"
                  >
                    {site.description}
                  </Text>
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
          <Text
            as="div"
            variant="muted"
            truncate
            align="right"
            className="max-w-[200px]"
            title={row.original.webUrl}
          >
            {getPathFromUrl(row.original.webUrl)}
          </Text>
        ),
      },
    ],
    [tTables, t],
  );

  if (!isLoading && (!sites || sites.length === 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-center">
        <SharePointIcon className="mb-4 size-12 opacity-50" />
        <Heading level={3} size="lg" weight="medium" className="mb-2">
          {t('microsoft365.noSites')}
        </Heading>
        <Text variant="muted" className="max-w-md">
          {t('microsoft365.noSitesDescription')}
        </Text>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={sites}
      isLoading={isLoading}
      approxRowCount={5}
      getRowId={(row) => row.id}
      onRowClick={(row) => onSiteClick(row.original)}
    />
  );
}
