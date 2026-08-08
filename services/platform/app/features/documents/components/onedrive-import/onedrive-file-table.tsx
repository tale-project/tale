'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import { MicrosoftReauthButton } from '../microsoft-reauth-button';
import type { OneDriveApiItem, OneDriveSelectedItem } from './types';
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
  const { formatDate, timezoneShort } = useFormatDate();
  const { locale } = useFormatNumber();
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
            <HStack gap={2} className="min-w-0">
              <DocumentIcon fileName={item.name} isFolder={isFolder(item)} />
              {isFolder(item) ? (
                <button
                  type="button"
                  title={item.name}
                  className="text-foreground min-w-0 flex-1 cursor-pointer truncate text-left text-base font-medium hover:text-blue-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFolderClick(item);
                  }}
                >
                  {item.name}
                </button>
              ) : (
                <span
                  title={item.name}
                  className="text-foreground min-w-0 flex-1 truncate text-base font-medium"
                >
                  {item.name}
                </span>
              )}
            </HStack>
          );
        },
      },
      {
        id: 'modified',
        header: () => (
          <div className="text-right">{tTables('headers.updated')}</div>
        ),
        cell: ({ row }) => (
          <Text
            as="div"
            variant="muted"
            className="text-right whitespace-nowrap"
          >
            {row.original.lastModified
              ? `${formatDate(new Date(row.original.lastModified), 'long', {
                  customFormat: 'll LT',
                })} ${timezoneShort}`
              : ''}
          </Text>
        ),
      },
      {
        id: 'size',
        header: () => (
          <div className="text-right">{tTables('headers.size')}</div>
        ),
        cell: ({ row }) => (
          <Text
            as="div"
            variant="muted"
            className="text-right whitespace-nowrap"
          >
            {row.original.size ? formatBytes(row.original.size, locale) : ''}
          </Text>
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
      timezoneShort,
      locale,
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

  return (
    <DataTable
      columns={columns}
      data={items}
      isLoading={isLoading}
      approxRowCount={5}
      getRowId={(row) => row.id}
      emptyState={emptyState}
    />
  );
}
