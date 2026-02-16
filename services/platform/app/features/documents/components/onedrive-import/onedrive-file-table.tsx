'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { HStack } from '@/app/components/ui/layout/layout';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import type { OneDriveApiItem, OneDriveSelectedItem } from './types';

import { MicrosoftReauthButton } from '../microsoft-reauth-button';
import { isFolder } from './types';

interface OneDriveFileTableProps {
  items: OneDriveApiItem[];
  isLoading: boolean;
  isMicrosoftAccountError: boolean;
  searchQuery: string;
  selectedItems: Map<string, OneDriveSelectedItem>;
  getSelectAllState: () => boolean | 'indeterminate';
  handleSelectAllChange: (checked: boolean | 'indeterminate') => void;
  getCheckedState: (item: OneDriveSelectedItem) => boolean;
  handleCheckChange: (itemId: string, isSelected: boolean) => void;
  handleFolderClick: (folder: OneDriveApiItem) => void;
  buildItemPath: (item: OneDriveApiItem) => string;
}

export function OneDriveFileTable({
  items,
  isLoading,
  isMicrosoftAccountError,
  searchQuery,
  getSelectAllState,
  handleSelectAllChange,
  getCheckedState,
  handleCheckChange,
  handleFolderClick,
  buildItemPath,
}: OneDriveFileTableProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('documents');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<OneDriveApiItem>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <Checkbox
            checked={getSelectAllState()}
            onCheckedChange={handleSelectAllChange}
            disabled={items.length === 0}
          />
        ),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <Checkbox
              checked={getCheckedState({
                id: item.id,
                name: item.name,
                path: buildItemPath(item),
                type: isFolder(item) ? 'folder' : 'file',
              })}
              onCheckedChange={(checked) =>
                handleCheckChange(item.id, Boolean(checked))
              }
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
        size: 48,
      },
      {
        id: 'name',
        header: tTables('headers.name'),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <HStack gap={2}>
              <DocumentIcon fileName={item.name} isFolder={isFolder(item)} />
              <div
                title={item.name}
                className={`text-foreground max-w-[25rem] truncate text-base font-medium ${
                  isFolder(item) ? 'cursor-pointer hover:text-blue-600' : ''
                }`}
                onClick={
                  isFolder(item)
                    ? (e) => {
                        e.stopPropagation();
                        handleFolderClick(item);
                      }
                    : undefined
                }
                onKeyDown={
                  isFolder(item)
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleFolderClick(item);
                        }
                      }
                    : undefined
                }
                role={isFolder(item) ? 'button' : undefined}
                tabIndex={isFolder(item) ? 0 : undefined}
              >
                {item.name}
              </div>
            </HStack>
          );
        },
      },
      {
        id: 'modified',
        header: () => (
          <div className="text-right">{tTables('headers.modified')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-muted-foreground text-right text-sm whitespace-nowrap">
            {row.original.lastModified
              ? formatDate(new Date(row.original.lastModified), 'short')
              : ''}
          </div>
        ),
      },
      {
        id: 'size',
        header: () => (
          <div className="text-right">{tTables('headers.size')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-muted-foreground text-right text-sm whitespace-nowrap">
            {row.original.size ? formatBytes(row.original.size) : ''}
          </div>
        ),
      },
    ],
    [
      getSelectAllState,
      handleSelectAllChange,
      items.length,
      getCheckedState,
      buildItemPath,
      handleCheckChange,
      handleFolderClick,
      tTables,
      formatDate,
    ],
  );

  const emptyState = useMemo(() => {
    if (isMicrosoftAccountError) {
      return {
        title: t('onedrive.microsoftNotConnected'),
        description: t('onedrive.microsoftNotConnectedDescription'),
        customAction: <MicrosoftReauthButton className="mx-auto" />,
      };
    }
    if (searchQuery) {
      return {
        title: t('noItemsFound'),
        description: t('noItemsMatchingSearch'),
      };
    }
    return {
      title: t('noItemsAvailable'),
      description: t('onedrive.folderEmpty'),
    };
  }, [isMicrosoftAccountError, searchQuery, t]);

  if (isLoading) {
    return <DataTableSkeleton columns={columns} rows={5} />;
  }

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyState={emptyState}
    />
  );
}
