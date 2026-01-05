'use client';

import { useState, useMemo } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, DataTableSkeleton } from '@/components/ui/data-table';
import { Stack, HStack } from '@/components/ui/layout';
import { toast } from '@/hooks/use-toast';
import { Search, Home, Loader2, Database, X } from 'lucide-react';
import type { DriveItem } from '@/types/microsoft-graph';
import {
  isFolder,
  isFile,
  formatFileSize,
  formatDate,
} from '@/lib/utils/onedrive-helpers';
import { useQuery } from '@tanstack/react-query';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useSyncStatus, type FileProcessingStatus } from './sync-status';
import { MicrosoftReauthButton } from './microsoft-reauth-button';
import { DocumentIcon } from '@/components/ui/document-icon';
import type { ColumnDef } from '@tanstack/react-table';
import { useT } from '@/lib/i18n';

interface OneDriveImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

type ImportType = 'one-time' | 'sync';
type Stage = 'picker' | 'settings';

type OneDriveItem = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
};

interface OneDriveFileTableProps {
  items: DriveItem[];
  isLoading: boolean;
  isMicrosoftAccountError: boolean;
  searchQuery: string;
  selectedItems: Map<string, OneDriveItem>;
  getSelectAllState: () => boolean | 'indeterminate';
  handleSelectAllChange: (checked: boolean | 'indeterminate') => void;
  getCheckedState: (item: OneDriveItem) => boolean;
  handleCheckChange: (itemId: string, isSelected: boolean) => void;
  handleFolderClick: (folder: DriveItem) => void;
  buildItemPath: (item: DriveItem) => string;
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
  const { t } = useT('documents');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<DriveItem>[]>(
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
              <DocumentIcon fileName={item.name} />
              <div
                title={item.name}
                className={`font-medium text-base text-foreground truncate max-w-[25rem] ${
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
              >
                {item.name}
              </div>
            </HStack>
          );
        },
      },
      {
        id: 'modified',
        header: () => <div className="text-right">{tTables('headers.modified')}</div>,
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground whitespace-nowrap text-right">
            {formatDate(row.original.lastModifiedDateTime)}
          </div>
        ),
      },
      {
        id: 'size',
        header: () => <div className="text-right">{tTables('headers.size')}</div>,
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground text-right whitespace-nowrap">
            {row.original.size ? formatFileSize(row.original.size) : ''}
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
    ],
  );

  const emptyState = isMicrosoftAccountError
    ? {
        title: t('onedrive.microsoftNotConnected'),
        description: t('onedrive.microsoftNotConnectedDescription'),
        customAction: <MicrosoftReauthButton className="mx-auto" />,
      }
    : searchQuery
      ? {
          title: t('noItemsFound'),
          description: t('noItemsMatchingSearch'),
        }
      : {
          title: t('noItemsAvailable'),
          description: t('onedrive.folderEmpty'),
        };

  // Show skeleton while loading
  if (isLoading) {
    return (
      <DataTableSkeleton
        columns={columns}
        rows={5}
        showPagination={false}
      />
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

  // OneDrive file listing via Convex action
  const listOneDriveFiles = useAction(api.onedrive.listFiles);

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');

  // Sync state management
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAbortController, setSyncAbortController] =
    useState<AbortController | null>(null);
  const syncStatus = useSyncStatus();

  // File picker state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<Map<string, OneDriveItem>>(
    new Map(),
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([{ id: undefined, name: t('breadcrumb.oneDrive') }]);

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
        if (!result.success || !result.data) {
          throw new Error(result.error || t('onedrive.loadFailed'));
        }
        return result.data.value;
      } catch (error) {
        toast({
          title: t('onedrive.loadFailed'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    enabled: stage === 'picker',
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });

  // Check if error is due to missing Microsoft account
  const isMicrosoftAccountError =
    loadError instanceof Error &&
    loadError.message.includes('Microsoft account not connected');

  // Function to recursively collect all files from folders with path preservation
  const collectAllFiles = async (
    items: DriveItem[],
    currentPath: string = '',
    directlySelectedItems?: Set<string>,
    selectedParentInfo?: { id: string; name: string; path: string } | null,
  ): Promise<
    (FileProcessingStatus & {
      relativePath?: string;
      isDirectlySelected?: boolean;
      selectedParentId?: string;
      selectedParentName?: string;
      selectedParentPath?: string;
    })[]
  > => {
    const allFiles: (FileProcessingStatus & {
      relativePath?: string;
      isDirectlySelected?: boolean;
      selectedParentId?: string;
      selectedParentName?: string;
      selectedParentPath?: string;
    })[] = [];

    for (const item of items) {
      if (isFile(item)) {
        const isDirectlySelected = directlySelectedItems?.has(item.id) ?? false;

        allFiles.push({
          id: item.id,
          name: item.name,
          status: 'pending',
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
          // Get files from this folder
          const folderResult = await listOneDriveFiles({
            folderId: item.id,
            pageSize: 100,
          });

          if (folderResult.success && folderResult.data) {
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
              folderResult.data.value,
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

  // Function to start sync with SSE streaming
  const startSyncWithStream = async (
    items: Array<{
      id: string;
      name: string;
      size?: number;
      relativePath?: string;
    }>,
    organizationId: string,
    abortController: AbortController,
    importType: ImportType,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Prepare request body with import type differentiation
      const requestBody = {
        items,
        organizationId,
        importType, // Pass import type to backend
      };

      // Create SSE connection with POST data and abort signal
      fetch('/api/documents/onedrive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error(t('import.noResponseBody'));
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  resolve();
                  break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    // const eventType = line.substring(7); // Event type for future use
                    continue;
                  }

                  if (line.startsWith('data: ')) {
                    const data = line.substring(6);

                    try {
                      const parsedData = JSON.parse(data);

                      // Handle different event types based on the data structure
                      // Note: handle completion before progress because a 'complete' event may include progress: 100
                      if (parsedData.success !== undefined) {
                        // Complete/error event
                        syncStatus.completeSync({
                          success: parsedData.success,
                          error: parsedData.error,
                          syncedFiles: [], // Will be populated from file statuses
                          failedFiles: [], // Will be populated from file statuses
                          totalFiles: items.length,
                        });

                        if (parsedData.success) {
                          toast({
                            variant: 'success',
                            title: importType === 'one-time' ? t('onedrive.importCompleted') : t('onedrive.syncCompleted'),
                            description: importType === 'one-time' ? t('onedrive.filesImported') : t('onedrive.filesSynced'),
                          });

                          // Clear selection after successful operation
                          setSelectedItems(new Map());
                          onSuccess?.();
                        } else {
                          toast({
                            title: importType === 'one-time' ? t('onedrive.importFailed') : t('onedrive.syncFailed'),
                            description:
                              parsedData.error || tCommon('errors.generic'),
                            variant: 'destructive',
                          });
                        }
                      } else if (parsedData.fileId) {
                        // File status event
                        syncStatus.updateFileStatus(
                          parsedData.fileId,
                          parsedData.status,
                          parsedData.error,
                        );
                      } else if (parsedData.progress !== undefined) {
                        // Progress event
                        syncStatus.updateProgress(
                          parsedData.progress,
                          parsedData.currentFile || 'Processing...',
                        );

                        if (parsedData.files) {
                          parsedData.files.forEach(
                            (file: {
                              id: string;
                              status:
                                | 'pending'
                                | 'processing'
                                | 'completed'
                                | 'failed';
                              error?: string;
                            }) => {
                              syncStatus.updateFileStatus(
                                file.id,
                                file.status,
                                file.error,
                              );
                            },
                          );
                        }
                      }
                    } catch (parseError) {
                      console.error(parseError);
                      toast({
                        title: t('onedrive.failedToParseSSE'),
                        variant: 'destructive',
                      });
                    }
                  }
                }
              }
            } catch (streamError) {
              toast({
                title: t('onedrive.failedToProcessStream'),
                variant: 'destructive',
              });
              reject(streamError);
            }
          };

          processStream();
        })
        .catch((error) => {
          // Check if the error is due to abort
          if (error.name === 'AbortError') {
            toast({
              title: importType === 'one-time' ? t('onedrive.importCancelled') : t('onedrive.syncCancelled'),
              description: importType === 'one-time' ? t('onedrive.importCancelledDescription') : t('onedrive.syncCancelledDescription'),
              variant: 'default',
            });
            reject(
              new Error(
                t('onedrive.cancelledByUser', { type: importType }),
              ),
            );
          } else {
            toast({
              title: importType === 'one-time' ? t('onedrive.importFailed') : t('onedrive.syncFailed'),
              description: t('onedrive.failedToStart', { type: importType }),
              variant: 'destructive',
            });
            reject(error);
          }
        });
    });
  };

  // Helper function to build hierarchical path for an item
  const buildItemPath = (item: DriveItem): string => {
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
  const getCheckedState = (item: OneDriveItem): boolean => {
    return selectedItems.has(item.id);
  };

  const handleCheckChange = (itemId: string, isSelected: boolean) => {
    const newSelectedItems = new Map(selectedItems);

    if (isSelected) {
      // Find the item details and store with path
      const item = (itemsData || []).find((i: DriveItem) => i.id === itemId);
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

    filteredItems.forEach((item: DriveItem) => {
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

    const selectedCount = filteredItems.filter((item: DriveItem) =>
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

  const handleFolderClick = (folder: DriveItem) => {
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

      setIsSyncing(true);

      // Create abort controller for this operation
      const abortController = new AbortController();
      setSyncAbortController(abortController);

      // Convert selected items to DriveItem format for collectAllFiles
      const driveItems: DriveItem[] = selectedItemsArray.map((item: OneDriveItem) => ({
        id: item.id,
        name: item.name,
        // Add required DriveItem properties
        lastModifiedDateTime: '',
        createdDateTime: '',
        size: item.size ?? 0,
        webUrl: '',
        parentReference: {
          driveId: '',
          driveType: 'personal',
          id: '',
          path: '',
        },
        // Determine if it's a folder or file based on type
        ...(item.type === 'folder'
          ? {
              folder: { childCount: 0 },
            }
          : {
              file: { mimeType: '' },
            }),
      }));

      // Create Set of directly selected item IDs
      const directlySelectedIds = new Set(
        selectedItemsArray.map((item: OneDriveItem) => item.id),
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

      // Show sync status dialog
      syncStatus.showSync(allFiles);

      // Show toast notification as backup
      toast({
        title: importType === 'one-time' ? t('onedrive.importStarted') : t('onedrive.syncStarted'),
        description: importType === 'one-time'
          ? t('onedrive.importingItems', { count: selectedItemsArray.length })
          : t('onedrive.syncingItems', { count: selectedItemsArray.length }),
      });

      // Start import/sync with streaming
      await startSyncWithStream(
        allFiles.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          relativePath: file.relativePath,
          isDirectlySelected: file.isDirectlySelected,
          selectedParentId: file.selectedParentId,
          selectedParentName: file.selectedParentName,
          selectedParentPath: file.selectedParentPath,
        })),
        organizationId,
        abortController,
        importType,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : tCommon('errors.generic');

      toast({
        title: importType === 'one-time' ? t('onedrive.importFailed') : t('onedrive.syncFailed'),
        description: errorMessage,
        variant: 'destructive',
      });

      syncStatus.completeSync({
        success: false,
        error: errorMessage,
        syncedFiles: [],
        failedFiles: [],
        totalFiles: 0,
      });
    } finally {
      setIsSyncing(false);
      setSyncAbortController(null);
    }
  };

  const filteredItems = (itemsData || []).filter((item: DriveItem) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (stage === 'picker') {
    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? (() => {})}
        title={t('onedrive.selectFiles')}
        hideClose
        className="max-w-5xl p-0"
        customHeader={
          <HStack align="start" justify="between" className="border-b border-border px-6 py-6">
            <Stack gap={1}>
              <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">
                {t('onedrive.selectFiles')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('onedrive.selectDescription')}
              </p>
            </Stack>
          </HStack>
        }
      >
        <Stack gap={4} className="px-6 py-2">
          {/* Breadcrumb Navigation */}
          {folderPath.length > 1 && (
            <HStack gap={2} className="text-sm text-muted-foreground">
              {folderPath.map((folder, index) => (
                <HStack
                  key={folder.id || 'root'}
                  gap={2}
                >
                  <button
                    type="button"
                    onClick={() => handleBreadcrumbClick(index)}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {index === 0 ? <Home className="size-4" /> : folder.name}
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
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder={t('searchFilesAndFolders')}
                size="sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
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
        </Stack>
      </Dialog>
    );
  }

  if (stage === 'settings') {
    const settingsFooter = (
      <HStack gap={4} className="justify-stretch w-full">
        <Button
          variant="outline"
          onClick={() => {
            if (isSyncing && syncAbortController) {
              syncAbortController.abort();
              setSyncAbortController(null);
              setIsSyncing(false);
              toast({
                title: importType === 'one-time' ? t('onedrive.importCancelled') : t('onedrive.syncCancelled'),
                description: importType === 'one-time' ? t('onedrive.importCancelledDescription') : t('onedrive.syncCancelledDescription'),
                variant: 'default',
              });
            } else {
              setStage('picker');
            }
          }}
          className="flex-1"
          disabled={false}
        >
          {isSyncing ? (
            <>
              <X className="size-4 mr-2" />
              {tCommon('actions.cancel')}
            </>
          ) : (
            tCommon('actions.back')
          )}
        </Button>
        <Button
          onClick={handleImport}
          className="flex-1"
          disabled={isSyncing}
        >
          {isSyncing ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              {importType === 'one-time' ? t('onedrive.importing') : t('onedrive.syncing')}
            </>
          ) : (
            <>
              <Database className="size-4 mr-2" />
              {t('onedrive.importItem', { type: importType, count: selectedItems.size })}
            </>
          )}
        </Button>
      </HStack>
    );

    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? (() => {})}
        title={t('onedrive.importSettings')}
        description={t('onedrive.settingsDescription', { count: selectedItems.size })}
        size="md"
        hideClose
        className="p-0"
        customHeader={
          <div className="border-b border-border flex items-start justify-between px-6 py-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">
                {t('onedrive.importSettings')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('onedrive.settingsDescription', { count: selectedItems.size })}
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
              setImportType(value as ImportType)
            }
            className="space-y-2"
          >
            {/* One-time Import Option */}
            <div className="border border-border rounded-lg p-3 hover:bg-muted">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="one-time" id="one-time" />
                <div className="flex-1">
                  <label
                    htmlFor="one-time"
                    className="font-medium text-base cursor-pointer"
                  >
                    {t('onedrive.oneTimeImport')}
                  </label>
                  <div className="text-sm text-muted-foreground">
                    {t('onedrive.oneTimeDescription')}
                  </div>
                </div>
              </div>
            </div>

            {/* Sync Import Option */}
            <div className="border border-border rounded-lg p-3 hover:bg-muted">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="sync" id="sync" />
                <div className="flex-1">
                  <label
                    htmlFor="sync"
                    className="font-medium text-base cursor-pointer"
                  >
                    {t('onedrive.syncImport')}
                  </label>
                  <div className="text-sm text-muted-foreground">
                    {t('onedrive.syncDescription')}
                  </div>
                </div>
              </div>
            </div>
          </RadioGroup>
        </div>
      </Dialog>
    );
  }
}
