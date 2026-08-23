'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
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
              <Row
                gap={0}
                justify="center"
                className="size-8 rounded-md bg-teal-100 dark:bg-teal-900/30"
              >
                <SharePointIcon className="size-5" />
              </Row>
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
        header: t('microsoft365.siteUrl'),
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <Text
            as="div"
            variant="muted"
            truncate
            align="right"
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
      <EmptyState
        icon={SharePointIcon}
        title={t('microsoft365.noSites')}
        description={t('microsoft365.noSitesDescription')}
      />
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
