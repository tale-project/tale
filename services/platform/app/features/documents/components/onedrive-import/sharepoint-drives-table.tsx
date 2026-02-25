'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Database } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { SharePointDrive } from './types';

interface SharePointDrivesTableProps {
  drives: SharePointDrive[];
  isLoading: boolean;
  onDriveClick: (drive: SharePointDrive) => void;
}

export function SharePointDrivesTable({
  drives,
  isLoading,
  onDriveClick,
}: SharePointDrivesTableProps) {
  const { t } = useT('documents');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<SharePointDrive>[]>(
    () => [
      {
        id: 'name',
        header: tTables('headers.name'),
        cell: ({ row }) => {
          const drive = row.original;
          return (
            <HStack gap={3}>
              <div className="flex size-8 items-center justify-center rounded-md bg-amber-100 dark:bg-amber-900/30">
                <Database className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-foreground cursor-pointer truncate font-medium hover:text-blue-600">
                  {drive.name}
                </div>
                {drive.description && (
                  <Text
                    as="div"
                    variant="caption"
                    truncate
                    className="max-w-md"
                  >
                    {drive.description}
                  </Text>
                )}
              </div>
            </HStack>
          );
        },
      },
      {
        id: 'type',
        header: () => (
          <div className="text-right">{t('microsoft365.driveType')}</div>
        ),
        cell: ({ row }) => (
          <Text as="div" variant="muted" align="right" className="capitalize">
            {row.original.driveType}
          </Text>
        ),
      },
    ],
    [tTables, t],
  );

  if (!isLoading && (!drives || drives.length === 0)) {
    return (
      <EmptyState
        icon={Database}
        title={t('microsoft365.noDrives')}
        description={t('microsoft365.noDrivesDescription')}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={drives}
      isLoading={isLoading}
      approxRowCount={5}
      getRowId={(row) => row.id}
      onRowClick={(row) => onDriveClick(row.original)}
    />
  );
}
