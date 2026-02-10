'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useQuery } from '@tanstack/react-query';
import { useAction, useQuery as useConvexQuery } from 'convex/react';
import { Home, Loader2, Database, Users } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { formatBytes } from '@/lib/utils/format/number';

import { MicrosoftReauthButton } from './microsoft-reauth-button';

// Normalized OneDrive item type returned by Convex action
type OneDriveApiItem = {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType?: string;
  lastModified?: number;
  childCount?: number;
  webUrl?: string;
};

const isFolder = (item: OneDriveApiItem): boolean => item.isFolder;
const isFile = (item: OneDriveApiItem): boolean => !item.isFolder;

const getPathFromUrl = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

interface OneDriveImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

type ImportType = 'one-time' | 'sync';
type Stage = 'picker' | 'settings';
type SourceTab = 'onedrive' | 'sharepoint';

const noop = () => {};

// SharePoint types
type SharePointSite = {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
  description?: string;
};

type SharePointDrive = {
  id: string;
  name: string;
  driveType: string;
  webUrl?: string;
  description?: string;
};

// SharePoint Sites Table Component
interface SharePointSitesTableProps {
  sites: SharePointSite[];
  isLoading: boolean;
  onSiteClick: (site: SharePointSite) => void;
}

function SharePointSitesTable({
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
    return (
      <DataTableSkeleton columns={columns} rows={5} showPagination={false} />
    );
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

// SharePoint Drives Table Component
interface SharePointDrivesTableProps {
  drives: SharePointDrive[];
  isLoading: boolean;
  onDriveClick: (drive: SharePointDrive) => void;
}

function SharePointDrivesTable({
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
    return (
      <DataTableSkeleton columns={columns} rows={5} showPagination={false} />
    );
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

type OneDriveSelectedItem = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
};

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

function OneDriveFileTable({
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

  // Show skeleton while loading
  if (isLoading) {
    return (
      <DataTableSkeleton columns={columns} rows={5} showPagination={false} />
    );
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

export function OneDriveImportDialog({
  organizationId,
  onSuccess,
  ...props
}: OneDriveImportDialogProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  // OneDrive file listing via Convex action
  const listOneDriveFiles = useAction(api.onedrive.actions.listFiles);
  const importFilesAction = useAction(api.onedrive.actions.importFiles);

  const listSharePointSites = useAction(
    api.onedrive.actions.listSharePointSites,
  );
  const listSharePointDrives = useAction(
    api.onedrive.actions.listSharePointDrives,
  );
  const listSharePointFiles = useAction(
    api.onedrive.actions.listSharePointFiles,
  );

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    () => selectedTeamId ? new Set([selectedTeamId]) : new Set(),
  );

  // Source tab state
  const [sourceTab, setSourceTab] = useState<SourceTab>('onedrive');

  // SharePoint navigation state
  const [selectedSite, setSelectedSite] = useState<SharePointSite | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<SharePointDrive | null>(
    null,
  );
  const [spFolderId, setSpFolderId] = useState<string | undefined>(undefined);
  const [spFolderPath, setSpFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([]);

  // Import state
  const [isImporting, setIsImporting] = useState(false);

  // File picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<
    Map<string, OneDriveSelectedItem>
  >(new Map());
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([{ id: undefined, name: t('breadcrumb.oneDrive') }]);

  // Fetch user's teams via Convex query (only in settings stage)
  const teamsResult = useConvexQuery(
    api.members.queries.getMyTeams,
    stage === 'settings' ? { organizationId } : 'skip',
  );
  const teams = teamsResult?.teams ?? null;
  const isLoadingTeams = teamsResult === undefined;

  const handleToggleTeam = useCallback((teamId: string) => {
    setSelectedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }, []);

  // React Query for OneDrive files and folders
  const {
    data: itemsData,
    isLoading: loading,
    error: loadError,
  } = useQuery({
    queryKey: ['onedrive-items', currentFolderId],
    queryFn: async () => {
      try {
        const result = await listOneDriveFiles({ folderId: currentFolderId });
        if (!result.success || !result.items) {
          throw new Error(result.error || t('onedrive.loadFailed'));
        }
        return result.items;
      } catch (error) {
        toast({
          title: t('onedrive.loadFailed'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    enabled: stage === 'picker' && sourceTab === 'onedrive',
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });

  // React Query for SharePoint sites
  const { data: sitesData, isLoading: loadingSites } = useQuery({
    queryKey: ['sharepoint-sites'],
    queryFn: async () => {
      const result = await listSharePointSites({});
      if (!result.success || !result.sites) {
        throw new Error(result.error || t('onedrive.loadFailed'));
      }
      return result.sites;
    },
    enabled: stage === 'picker' && sourceTab === 'sharepoint' && !selectedSite,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // React Query for SharePoint drives (document libraries)
  const { data: drivesData, isLoading: loadingDrives } = useQuery({
    queryKey: ['sharepoint-drives', selectedSite?.id],
    queryFn: async () => {
      if (!selectedSite) throw new Error('No site selected');
      const result = await listSharePointDrives({ siteId: selectedSite.id });
      if (!result.success || !result.drives) {
        throw new Error(result.error || t('onedrive.loadFailed'));
      }
      return result.drives;
    },
    enabled:
      stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !selectedDrive,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // React Query for SharePoint files
  const { data: spFilesData, isLoading: loadingSpFiles } = useQuery({
    queryKey: [
      'sharepoint-files',
      selectedSite?.id,
      selectedDrive?.id,
      spFolderId,
    ],
    queryFn: async () => {
      if (!selectedSite || !selectedDrive)
        throw new Error('No site/drive selected');
      const result = await listSharePointFiles({
        siteId: selectedSite.id,
        driveId: selectedDrive.id,
        folderId: spFolderId,
      });
      if (!result.success || !result.items) {
        throw new Error(result.error || t('onedrive.loadFailed'));
      }
      return result.items;
    },
    enabled:
      stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !!selectedDrive,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  // Check if error is due to missing Microsoft account
  const isMicrosoftAccountError =
    loadError instanceof Error &&
    loadError.message.includes('Microsoft account not connected');

  type CollectedFile = {
    id: string;
    name: string;
    size: number;
    relativePath?: string;
    isDirectlySelected?: boolean;
    selectedParentId?: string;
    selectedParentName?: string;
    selectedParentPath?: string;
  };

  // Function to recursively collect all files from folders with path preservation
  const collectAllFiles = async (
    items: OneDriveApiItem[],
    currentPath: string = '',
    directlySelectedItems?: Set<string>,
    selectedParentInfo?: { id: string; name: string; path: string } | null,
  ): Promise<CollectedFile[]> => {
    const allFiles: CollectedFile[] = [];

    for (const item of items) {
      if (isFile(item)) {
        const isDirectlySelected = directlySelectedItems?.has(item.id) ?? false;

        allFiles.push({
          id: item.id,
          name: item.name,
          size: item.size,
          relativePath: currentPath,
          isDirectlySelected,
          // If not directly selected, include parent directory info
          ...(!isDirectlySelected &&
            selectedParentInfo && {
              selectedParentId: selectedParentInfo.id,
              selectedParentName: selectedParentInfo.name,
              selectedParentPath: selectedParentInfo.path,
            }),
        });
      } else if (isFolder(item)) {
        try {
          // Get files from this folder (use appropriate API based on source)
          let folderResult;
          if (sourceTab === 'sharepoint' && selectedSite && selectedDrive) {
            folderResult = await listSharePointFiles({
              siteId: selectedSite.id,
              driveId: selectedDrive.id,
              folderId: item.id,
            });
          } else {
            folderResult = await listOneDriveFiles({
              folderId: item.id,
            });
          }

          if (folderResult.success && folderResult.items) {
            // Build the path for files in this folder
            const folderPath = currentPath
              ? `${currentPath}/${item.name}`
              : item.name;

            // Determine if this folder was directly selected
            const isFolderDirectlySelected =
              directlySelectedItems?.has(item.id) ?? false;

            // If this folder was directly selected, it becomes the selected parent for its contents
            const parentInfoForSubFiles = isFolderDirectlySelected
              ? { id: item.id, name: item.name, path: folderPath }
              : selectedParentInfo; // Inherit from current parent if not directly selected

            // Recursively collect files from subfolders
            const subFiles = await collectAllFiles(
              folderResult.items,
              folderPath,
              directlySelectedItems,
              parentInfoForSubFiles,
            );
            allFiles.push(...subFiles);
          }
        } catch (error) {
          console.error(error);
          toast({
            title: t('onedrive.loadFailed'),
            variant: 'destructive',
          });
        }
      }
    }

    return allFiles;
  };

  // Helper function to build hierarchical path for an item
  const buildItemPath = (item: OneDriveApiItem): string => {
    const pathParts = [];

    // Add each folder in the current navigation path
    folderPath.forEach((folder) => {
      if (folder.id) {
        pathParts.push(folder.id);
      }
    });

    // Add the item itself
    pathParts.push(item.id);

    return pathParts.join('/');
  };

  // Simple selection state - each item is independently selectable
  const getCheckedState = (item: OneDriveSelectedItem): boolean => {
    return selectedItems.has(item.id);
  };

  const handleCheckChange = (itemId: string, isSelected: boolean) => {
    const newSelectedItems = new Map(selectedItems);

    if (isSelected) {
      // Find the item details from the correct data source based on current tab
      const dataSource =
        sourceTab === 'sharepoint' ? spFilesData || [] : itemsData || [];
      const item = dataSource.find((i: OneDriveApiItem) => i.id === itemId);
      if (item) {
        newSelectedItems.set(itemId, {
          id: item.id,
          name: item.name,
          path: buildItemPath(item),
          type: isFolder(item) ? 'folder' : 'file',
          size: item.size,
        });
      }
    } else {
      newSelectedItems.delete(itemId);
    }

    setSelectedItems(newSelectedItems);
  };

  // Select All functionality
  const selectAllVisible = () => {
    const newSelectedItems = new Map(selectedItems);

    filteredItems.forEach((item: OneDriveApiItem) => {
      newSelectedItems.set(item.id, {
        id: item.id,
        name: item.name,
        path: buildItemPath(item),
        type: isFolder(item) ? 'folder' : 'file',
        size: item.size,
      });
    });

    setSelectedItems(newSelectedItems);
  };

  const deselectAll = () => {
    setSelectedItems(new Map());
  };

  const getSelectAllState = (): boolean | 'indeterminate' => {
    if (filteredItems.length === 0) return false;

    const selectedCount = filteredItems.filter((item: OneDriveApiItem) =>
      selectedItems.has(item.id),
    ).length;

    if (selectedCount === 0) return false;
    if (selectedCount === filteredItems.length) return true;
    return 'indeterminate';
  };

  const handleSelectAllChange = (checked: boolean | 'indeterminate') => {
    if (checked === true || checked === 'indeterminate') {
      // If indeterminate or checked, select all visible
      selectAllVisible();
    } else {
      // If unchecked, deselect all
      deselectAll();
    }
  };

  const handleFolderClick = (folder: OneDriveApiItem) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    // Clear selections when navigating to a new folder
    setSelectedItems(new Map());
  };

  const handleBreadcrumbClick = (folderIndex: number) => {
    const targetFolder = folderPath[folderIndex];
    setCurrentFolderId(targetFolder.id);
    setFolderPath(folderPath.slice(0, folderIndex + 1));
    // Clear selections when navigating to a different folder
    setSelectedItems(new Map());
  };

  const proceedToSettings = () => {
    if (selectedItems.size === 0) {
      toast({
        title: t('noItemsSelected'),
        variant: 'destructive',
      });
      return;
    }
    setStage('settings');
  };

  const handleImport = async () => {
    try {
      const selectedItemsArray = Array.from(selectedItems.values());

      setIsImporting(true);

      // Convert selected items to OneDriveApiItem format for collectAllFiles
      const driveItems: OneDriveApiItem[] = selectedItemsArray.map(
        (item: OneDriveSelectedItem) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          isFolder: item.type === 'folder',
        }),
      );

      // Create Set of directly selected item IDs
      const directlySelectedIds = new Set(
        selectedItemsArray.map((item: OneDriveSelectedItem) => item.id),
      );

      // Convert current folder path to relative path string
      // Skip the first item (OneDrive root) and join the folder names
      const currentRelativePath = folderPath
        .slice(1) // Skip the root "OneDrive" entry
        .map((folder) => folder.name)
        .join('/');

      // Collect all files (including files within folders) with parent tracking
      const allFiles = await collectAllFiles(
        driveItems,
        currentRelativePath,
        directlySelectedIds,
      );

      // Show starting toast
      toast({
        title:
          importType === 'one-time'
            ? t('onedrive.importStarted')
            : t('onedrive.syncStarted'),
        description:
          importType === 'one-time'
            ? t('onedrive.importingItems', { count: allFiles.length })
            : t('onedrive.syncingItems', { count: allFiles.length }),
      });

      // Call import action
      const teamTags =
        selectedTeams.size > 0 ? Array.from(selectedTeams) : undefined;

      // Determine if this is a SharePoint import
      const isSharePoint =
        sourceTab === 'sharepoint' && selectedSite && selectedDrive;

      const result = await importFilesAction({
        items: allFiles.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          relativePath: file.relativePath,
          isDirectlySelected: file.isDirectlySelected,
          selectedParentId: file.selectedParentId,
          selectedParentName: file.selectedParentName,
          selectedParentPath: file.selectedParentPath,
          // Include SharePoint context if applicable
          ...(isSharePoint && {
            siteId: selectedSite.id,
            driveId: selectedDrive.id,
            sourceType: 'sharepoint' as const,
          }),
        })),
        organizationId,
        importType,
        teamTags,
      });

      if (result.success) {
        toast({
          variant: 'success',
          title:
            importType === 'one-time'
              ? t('onedrive.importCompleted')
              : t('onedrive.syncCompleted'),
          description:
            importType === 'one-time'
              ? t('onedrive.filesImportedCount', {
                  count: result.successCount,
                  total: result.totalFiles,
                })
              : t('onedrive.filesSyncedCount', {
                  count: result.successCount,
                  total: result.totalFiles,
                }),
        });

        // Clear selection after successful operation
        setSelectedItems(new Map());
        onSuccess?.();
      } else {
        toast({
          title:
            importType === 'one-time'
              ? t('onedrive.importFailed')
              : t('onedrive.syncFailed'),
          description: result.error || tCommon('errors.generic'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to import from OneDrive:', error);

      toast({
        title:
          importType === 'one-time'
            ? t('onedrive.importFailed')
            : t('onedrive.syncFailed'),
        description:
          error instanceof Error ? error.message : tCommon('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Get current items based on active tab
  const currentItems = useMemo(() => {
    if (sourceTab === 'sharepoint' && selectedSite && selectedDrive) {
      return (spFilesData || []).filter((item: OneDriveApiItem) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }
    return (itemsData || []).filter((item: OneDriveApiItem) =>
      item.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [
    sourceTab,
    selectedSite,
    selectedDrive,
    spFilesData,
    itemsData,
    searchQuery,
  ]);

  // Keep filteredItems for backward compatibility with OneDrive tab
  const filteredItems = currentItems;

  const handleTabChange = (tab: SourceTab) => {
    setSourceTab(tab);
    // Reset selection when switching tabs
    setSelectedItems(new Map());
    setSearchQuery('');
    // Reset SharePoint navigation
    if (tab === 'onedrive') {
      setSelectedSite(null);
      setSelectedDrive(null);
    }
  };

  if (stage === 'picker') {
    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? noop}
        title={t('microsoft365.title')}
        hideClose
        className="max-w-5xl p-0 sm:p-0"
        customHeader={
          <div className="border-border border-b">
            <HStack align="start" justify="between" className="px-6 pt-6 pb-4">
              <Stack gap={1}>
                <h2 className="text-foreground text-base leading-none font-semibold tracking-tight">
                  {t('microsoft365.title')}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t('microsoft365.selectDescription')}
                </p>
              </Stack>
            </HStack>
            {/* Tab Switcher */}
            <HStack gap={0} className="px-6">
              <button
                type="button"
                onClick={() => handleTabChange('onedrive')}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  sourceTab === 'onedrive'
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                }`}
              >
                <OneDriveIcon className="size-4" />
                {t('microsoft365.myOneDrive')}
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('sharepoint')}
                className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  sourceTab === 'sharepoint'
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                }`}
              >
                <SharePointIcon className="size-4" />
                {t('microsoft365.sharePointSites')}
              </button>
            </HStack>
          </div>
        }
      >
        <Stack gap={4} className="px-6 py-4">
          {/* OneDrive Tab Content */}
          {sourceTab === 'onedrive' && (
            <>
              {/* Breadcrumb Navigation */}
              {folderPath.length > 1 && (
                <HStack gap={2} className="text-muted-foreground text-sm">
                  {folderPath.map((folder, index) => (
                    <HStack key={folder.id || 'root'} gap={2}>
                      <button
                        type="button"
                        onClick={() => handleBreadcrumbClick(index)}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {index === 0 ? (
                          <Home className="size-4" />
                        ) : (
                          folder.name
                        )}
                      </button>
                      {index < folderPath.length - 1 && (
                        <span className="text-muted-foreground">/</span>
                      )}
                    </HStack>
                  ))}
                </HStack>
              )}

              {/* Search Input and Import Button */}
              <HStack gap={3}>
                <SearchInput
                  placeholder={t('searchFilesAndFolders')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  wrapperClassName="flex-1"
                />
                <Button
                  size="sm"
                  onClick={proceedToSettings}
                  disabled={selectedItems.size === 0}
                  className="px-6 whitespace-nowrap"
                >
                  {t('onedrive.importCount', { count: selectedItems.size })}
                </Button>
              </HStack>

              {/* Items List */}
              <div className="h-[500px] overflow-y-auto">
                <OneDriveFileTable
                  items={filteredItems}
                  isLoading={loading}
                  isMicrosoftAccountError={isMicrosoftAccountError}
                  searchQuery={searchQuery}
                  selectedItems={selectedItems}
                  getSelectAllState={getSelectAllState}
                  handleSelectAllChange={handleSelectAllChange}
                  getCheckedState={getCheckedState}
                  handleCheckChange={handleCheckChange}
                  handleFolderClick={handleFolderClick}
                  buildItemPath={buildItemPath}
                />
              </div>
            </>
          )}

          {/* SharePoint Tab Content */}
          {sourceTab === 'sharepoint' && (
            <>
              {/* SharePoint Breadcrumb */}
              <HStack gap={2} className="text-muted-foreground text-sm">
                {selectedSite && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSite(null);
                        setSelectedDrive(null);
                        setSpFolderId(undefined);
                        setSpFolderPath([]);
                        setSelectedItems(new Map());
                      }}
                      className="flex items-center gap-1 hover:text-blue-600 hover:underline"
                    >
                      <SharePointIcon className="size-4" />
                      {t('microsoft365.sharePointSites')}
                    </button>
                    <span>/</span>
                    {selectedDrive ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDrive(null);
                            setSpFolderId(undefined);
                            setSpFolderPath([]);
                            setSelectedItems(new Map());
                          }}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {selectedSite.displayName}
                        </button>
                        <span>/</span>
                        {spFolderPath.length > 0 ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSpFolderId(undefined);
                                setSpFolderPath([]);
                                setSelectedItems(new Map());
                              }}
                              className="hover:text-blue-600 hover:underline"
                            >
                              {selectedDrive.name}
                            </button>
                            {spFolderPath.map((folder, index) => (
                              <HStack key={folder.id || index} gap={2}>
                                <span>/</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSpFolderId(folder.id);
                                    setSpFolderPath(
                                      spFolderPath.slice(0, index + 1),
                                    );
                                    setSelectedItems(new Map());
                                  }}
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {folder.name}
                                </button>
                              </HStack>
                            ))}
                          </>
                        ) : (
                          <span className="text-foreground">
                            {selectedDrive.name}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-foreground">
                        {selectedSite.displayName}
                      </span>
                    )}
                  </>
                )}
              </HStack>

              {/* Sites List */}
              {!selectedSite && (
                <div className="h-[500px] overflow-y-auto">
                  <SharePointSitesTable
                    sites={sitesData || []}
                    isLoading={loadingSites}
                    onSiteClick={setSelectedSite}
                  />
                </div>
              )}

              {/* Drives List */}
              {selectedSite && !selectedDrive && (
                <div className="h-[500px] overflow-y-auto">
                  <SharePointDrivesTable
                    drives={drivesData || []}
                    isLoading={loadingDrives}
                    onDriveClick={setSelectedDrive}
                  />
                </div>
              )}

              {/* Files List (SharePoint) */}
              {selectedSite && selectedDrive && (
                <>
                  <HStack gap={3}>
                    <SearchInput
                      placeholder={t('searchFilesAndFolders')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      wrapperClassName="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={proceedToSettings}
                      disabled={selectedItems.size === 0}
                      className="px-6 whitespace-nowrap"
                    >
                      {t('onedrive.importCount', { count: selectedItems.size })}
                    </Button>
                  </HStack>
                  <div className="h-[440px] overflow-y-auto">
                    <OneDriveFileTable
                      items={currentItems}
                      isLoading={loadingSpFiles}
                      isMicrosoftAccountError={false}
                      searchQuery={searchQuery}
                      selectedItems={selectedItems}
                      getSelectAllState={getSelectAllState}
                      handleSelectAllChange={handleSelectAllChange}
                      getCheckedState={getCheckedState}
                      handleCheckChange={handleCheckChange}
                      handleFolderClick={(folder) => {
                        setSpFolderId(folder.id);
                        setSpFolderPath([
                          ...spFolderPath,
                          { id: folder.id, name: folder.name },
                        ]);
                        setSelectedItems(new Map());
                      }}
                      buildItemPath={buildItemPath}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </Stack>
      </Dialog>
    );
  }

  if (stage === 'settings') {
    const settingsFooter = (
      <HStack gap={4} className="w-full justify-stretch">
        <Button
          variant="outline"
          onClick={() => setStage('picker')}
          className="flex-1"
          disabled={isImporting}
        >
          {tCommon('actions.back')}
        </Button>
        <Button
          onClick={handleImport}
          className="flex-1"
          disabled={isImporting}
        >
          {isImporting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {importType === 'one-time'
                ? t('onedrive.importing')
                : t('onedrive.syncing')}
            </>
          ) : (
            <>
              <Database className="mr-2 size-4" />
              {importType === 'one-time'
                ? t('onedrive.importItems', { count: selectedItems.size })
                : t('onedrive.syncItems', { count: selectedItems.size })}
            </>
          )}
        </Button>
      </HStack>
    );

    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? noop}
        title={t('onedrive.importSettings')}
        description={t('onedrive.settingsDescription', {
          count: selectedItems.size,
        })}
        size="md"
        hideClose
        className="p-0 sm:p-0"
        customHeader={
          <div className="border-border flex items-start justify-between border-b px-6 py-5">
            <div className="space-y-1">
              <h2 className="text-foreground text-base leading-none font-semibold tracking-tight">
                {t('onedrive.importSettings')}
              </h2>
              <p className="text-muted-foreground text-sm">
                {t('onedrive.settingsDescription', {
                  count: selectedItems.size,
                })}
              </p>
            </div>
          </div>
        }
        footer={settingsFooter}
        footerClassName="border-t border-border p-4"
      >
        <div className="px-6 py-2">
          <RadioGroup
            value={importType}
            onValueChange={(value: string) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Radix RadioGroup onValueChange returns string
              setImportType(value as ImportType)
            }
            className="space-y-2"
          >
            {/* One-time Import Option */}
            <div className="border-border hover:bg-muted rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="one-time" id="one-time" />
                <div className="flex-1">
                  <label
                    htmlFor="one-time"
                    className="cursor-pointer text-base font-medium"
                  >
                    {t('onedrive.oneTimeImport')}
                  </label>
                  <div className="text-muted-foreground text-sm">
                    {t('onedrive.oneTimeDescription')}
                  </div>
                </div>
              </div>
            </div>

            {/* Sync Import Option */}
            <div className="border-border hover:bg-muted rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="sync" id="sync" />
                <div className="flex-1">
                  <label
                    htmlFor="sync"
                    className="cursor-pointer text-base font-medium"
                  >
                    {t('onedrive.syncImport')}
                  </label>
                  <div className="text-muted-foreground text-sm">
                    {t('onedrive.syncDescription')}
                  </div>
                </div>
              </div>
            </div>
          </RadioGroup>

          {/* Team Selection */}
          <div className="border-border mt-4 border-t pt-4">
            <p className="mb-2 text-sm font-medium">
              {t('upload.selectTeams')}
            </p>
            <p className="text-muted-foreground mb-3 text-xs">
              {t('upload.selectTeamsDescription')}
            </p>

            {isLoadingTeams ? (
              <div className="flex items-center justify-center py-4">
                <span className="text-muted-foreground text-sm">
                  {tCommon('actions.loading')}
                </span>
              </div>
            ) : !teams || teams.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <Users className="text-muted-foreground/50 mb-2 size-6" />
                <p className="text-muted-foreground text-sm">
                  {t('upload.noTeamsAvailable')}
                </p>
              </div>
            ) : (
              <Stack gap={2}>
                {teams.map((team: { id: string; name: string }) => (
                  <div
                    key={team.id}
                    className="bg-card hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <Checkbox
                      id={`onedrive-team-${team.id}`}
                      checked={selectedTeams.has(team.id)}
                      onCheckedChange={() => handleToggleTeam(team.id)}
                      disabled={isImporting}
                      label={team.name}
                    />
                  </div>
                ))}
              </Stack>
            )}

            <p className="text-muted-foreground mt-3 text-xs">
              {t('upload.allMembersHint')}
            </p>
          </div>
        </div>
      </Dialog>
    );
  }
}
