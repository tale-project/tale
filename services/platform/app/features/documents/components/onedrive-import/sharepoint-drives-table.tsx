'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Database } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { HStack } from '@/app/components/ui/layout/layout';
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
                  <div className="text-muted-foreground max-w-md truncate text-xs">
                    {drive.description}
                  </div>
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
          <div className="text-muted-foreground text-right text-sm capitalize">
            {row.original.driveType}
          </div>
        ),
      },
    ],
    [tTables, t],
  );

  if (isLoading) {
    return <DataTableSkeleton columns={columns} rows={5} />;
  }

  if (!drives || drives.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-12 text-center">
        <Database className="text-muted-foreground/50 mb-4 size-12" />
        <h3 className="text-foreground mb-2 text-lg font-medium">
          {t('microsoft365.noDrives')}
        </h3>
        <p className="text-muted-foreground max-w-md text-sm">
          {t('microsoft365.noDrivesDescription')}
        </p>
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={drives}
      getRowId={(row) => row.id}
      onRowClick={(row) => onDriveClick(row.original)}
    />
  );
}
