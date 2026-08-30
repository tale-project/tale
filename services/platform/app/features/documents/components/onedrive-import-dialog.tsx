'use client';

import { useMemo, useCallback, useState, useEffect } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useImportOneDriveFiles } from '../hooks/actions';
import {
  useCloudImportAuthorizationStatus,
  useOneDriveFiles,
  useSharePointDrives,
  useSharePointFiles,
  useSharePointSites,
} from '../hooks/queries';
import { OneDrivePickerStage } from './onedrive-import/onedrive-picker-stage';
import { OneDriveSettingsStage } from './onedrive-import/onedrive-settings-stage';
import type {
  OneDriveApiItem,
  OneDriveSelectedItem,
  SharePointSite,
  SharePointDrive,
  CollectedFile,
  ImportType,
  Stage,
  SourceTab,
} from './onedrive-import/types';
import { isFolder, isFile } from './onedrive-import/types';

function isCloudImportAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Microsoft account not connected') ||
    error.message.includes('OneDrive is not authorized') ||
    error.message.includes('Cloud import is not authorized')
  );
}

interface OneDriveImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
  /** Hand off to the compact connect dialog — never shrink this wide picker. */
  onRequireConnect?: () => void;
}

const noop = () => {};

export function OneDriveImportDialog({
  organizationId,
  onSuccess,
  onRequireConnect,
  open,
  onOpenChange,
}: OneDriveImportDialogProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  const { mutateAsync: importFilesAction, isPending: isImporting } =
    useImportOneDriveFiles();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBusy = isImporting || isSubmitting;
  const { mutateAsync: listOneDriveFiles } = useBackendAction(
    'onedrive/actions:listFiles',
  );
  const { mutateAsync: listSharePointFiles } = useBackendAction(
    'onedrive/actions:listSharePointFiles',
  );

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');
  const [selectedTeamId_local, setSelectedTeamId_local] = useState<
    string | undefined
  >(() => selectedTeamId ?? undefined);

  const [sourceTab, setSourceTab] = useState<SourceTab>('onedrive');
  const [selectedSite, setSelectedSite] = useState<SharePointSite | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<SharePointDrive | null>(
    null,
  );
  const [spFolderId, setSpFolderId] = useState<string | undefined>(undefined);
  const [spFolderPath, setSpFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState(
    new Map<string, OneDriveSelectedItem>(),
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([{ id: undefined, name: t('breadcrumb.oneDrive') }]);

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const { data: cloudImportAuth, isLoading: cloudImportAuthLoading } =
    useCloudImportAuthorizationStatus(organizationId, open === true);

  const handleDisconnected = useCallback(() => {
    setSelectedItems(new Map());
    setSearchQuery('');
    setCurrentFolderId(undefined);
    setFolderPath([{ id: undefined, name: t('breadcrumb.oneDrive') }]);
    setSelectedSite(null);
    setSelectedDrive(null);
    setSpFolderId(undefined);
    setSpFolderPath([]);
    setSourceTab('onedrive');
    // Close the wide picker and open the compact connect dialog — do not
    // morph this shell to md.
    (onOpenChange ?? noop)(false);
    onRequireConnect?.();
  }, [t, onOpenChange, onRequireConnect]);

  const handleSelectTeam = useCallback((teamId: string | undefined) => {
    setSelectedTeamId_local(teamId);
  }, []);

  const isMicrosoftConnected =
    !cloudImportAuthLoading && cloudImportAuth?.status === 'active';

  const {
    data: itemsData,
    isLoading: loading,
    error: loadError,
  } = useOneDriveFiles(
    organizationId,
    currentFolderId,
    stage === 'picker' && sourceTab === 'onedrive' && isMicrosoftConnected,
  );

  const {
    data: sitesData,
    isLoading: loadingSites,
    error: sitesError,
  } = useSharePointSites(
    organizationId,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !selectedSite &&
      isMicrosoftConnected,
  );

  const { data: drivesData, isLoading: loadingDrives } = useSharePointDrives(
    organizationId,
    selectedSite?.id,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !selectedDrive &&
      isMicrosoftConnected,
  );

  const { data: spFilesData, isLoading: loadingSpFiles } = useSharePointFiles(
    organizationId,
    selectedSite?.id,
    selectedDrive?.id,
    spFolderId,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !!selectedDrive &&
      isMicrosoftConnected,
  );

  const isMicrosoftAccountError =
    (!cloudImportAuthLoading &&
      (!cloudImportAuth || cloudImportAuth.status !== 'active')) ||
    isCloudImportAuthError(loadError) ||
    isCloudImportAuthError(sitesError);

  // Safety net: if the picker opens without a grant (or the grant dies
  // mid-session), hand off to the connect dialog instead of resizing.
  useEffect(() => {
    if (open !== true || cloudImportAuthLoading) return;
    if (!isMicrosoftAccountError) return;
    (onOpenChange ?? noop)(false);
    onRequireConnect?.();
  }, [
    open,
    onOpenChange,
    cloudImportAuthLoading,
    isMicrosoftAccountError,
    onRequireConnect,
  ]);

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
          // Full path including the file name — the backend derives the
          // destination folder chain by dropping the last segment, so a
          // folder-prefix-only path would flatten the import to the root.
          relativePath: currentPath ? `${currentPath}/${item.name}` : item.name,
          isDirectlySelected,
          ...(!isDirectlySelected &&
            selectedParentInfo && {
              selectedParentId: selectedParentInfo.id,
              selectedParentName: selectedParentInfo.name,
              selectedParentPath: selectedParentInfo.path,
            }),
        });
      } else if (isFolder(item)) {
        try {
          let folderResult;
          if (sourceTab === 'sharepoint' && selectedSite && selectedDrive) {
            folderResult = await listSharePointFiles({
              organizationId,
              siteId: selectedSite.id,
              driveId: selectedDrive.id,
              folderId: item.id,
            });
          } else {
            folderResult = await listOneDriveFiles({
              organizationId,
              folderId: item.id,
            });
          }

          if (folderResult.success && folderResult.items) {
            const folderPathStr = currentPath
              ? `${currentPath}/${item.name}`
              : item.name;

            const isFolderDirectlySelected =
              directlySelectedItems?.has(item.id) ?? false;

            const parentInfoForSubFiles = isFolderDirectlySelected
              ? { id: item.id, name: item.name, path: folderPathStr }
              : selectedParentInfo;

            const subFiles = await collectAllFiles(
              folderResult.items,
              folderPathStr,
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

  const buildItemPath = (item: OneDriveApiItem): string => {
    const pathParts: string[] = [];
    folderPath.forEach((folder) => {
      if (folder.id) {
        pathParts.push(folder.id);
      }
    });
    pathParts.push(item.id);
    return pathParts.join('/');
  };

  const getCheckedState = (item: OneDriveSelectedItem): boolean => {
    return selectedItems.has(item.id);
  };

  const handleCheckChange = (itemId: string, isSelected: boolean) => {
    const newSelectedItems = new Map(selectedItems);

    if (isSelected) {
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

  const filteredItems = currentItems;

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
      selectAllVisible();
    } else {
      deselectAll();
    }
  };

  const handleFolderClick = (folder: OneDriveApiItem) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    setSelectedItems(new Map());
  };

  const handleBreadcrumbClick = (folderIndex: number) => {
    const targetFolder = folderPath[folderIndex];
    setCurrentFolderId(targetFolder.id);
    setFolderPath(folderPath.slice(0, folderIndex + 1));
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

  const handleTabChange = (tab: SourceTab) => {
    setSourceTab(tab);
    setSelectedItems(new Map());
    setSearchQuery('');
    if (tab === 'onedrive') {
      setSelectedSite(null);
      setSelectedDrive(null);
    }
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    try {
      const selectedItemsArray = Array.from(selectedItems.values());

      const driveItems: OneDriveApiItem[] = selectedItemsArray.map(
        (item: OneDriveSelectedItem) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          isFolder: item.type === 'folder',
        }),
      );

      const directlySelectedIds = new Set(
        selectedItemsArray.map((item: OneDriveSelectedItem) => item.id),
      );

      const currentRelativePath = folderPath
        .slice(1)
        .map((folder) => folder.name)
        .join('/');

      const allFiles = await collectAllFiles(
        driveItems,
        currentRelativePath,
        directlySelectedIds,
      );

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

      const isSharePoint =
        sourceTab === 'sharepoint' && selectedSite && selectedDrive;

      const result = await importFilesAction({
        // oxlint-disable-next-line oxc/no-map-spread -- immutable transform
        items: allFiles.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          relativePath: file.relativePath,
          isDirectlySelected: file.isDirectlySelected,
          selectedParentId: file.selectedParentId,
          selectedParentName: file.selectedParentName,
          selectedParentPath: file.selectedParentPath,
          ...(isSharePoint && {
            siteId: selectedSite.id,
            driveId: selectedDrive.id,
            sourceType: 'sharepoint' as const,
          }),
        })),
        organizationId,
        importType,
        teamId: selectedTeamId_local,
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
      setIsSubmitting(false);
    }
  };

  if (stage === 'picker') {
    const picker = OneDrivePickerStage({
      sourceTab,
      searchQuery,
      selectedItems,
      filteredItems,
      loading,
      folderPath,
      sitesData,
      loadingSites,
      drivesData,
      loadingDrives,
      loadingSpFiles,
      currentItems,
      selectedSite,
      selectedDrive,
      spFolderPath,
      getSelectAllState,
      handleSelectAllChange,
      getCheckedState,
      handleCheckChange,
      handleFolderClick,
      buildItemPath,
      onTabChange: handleTabChange,
      onSearchChange: setSearchQuery,
      onBreadcrumbClick: handleBreadcrumbClick,
      onSiteClick: setSelectedSite,
      onDriveClick: setSelectedDrive,
      onSpFolderClick: (folder) => {
        setSpFolderId(folder.id);
        setSpFolderPath([
          ...spFolderPath,
          { id: folder.id, name: folder.name },
        ]);
        setSelectedItems(new Map());
      },
      onSpBreadcrumbReset: () => {
        setSpFolderId(undefined);
        setSpFolderPath([]);
        setSelectedItems(new Map());
      },
      onSpSiteReset: () => {
        setSelectedSite(null);
        setSelectedDrive(null);
        setSpFolderId(undefined);
        setSpFolderPath([]);
        setSelectedItems(new Map());
      },
      onSpDriveReset: () => {
        setSelectedDrive(null);
        setSpFolderId(undefined);
        setSpFolderPath([]);
        setSelectedItems(new Map());
      },
      onSpFolderBreadcrumbClick: (index) => {
        setSpFolderId(spFolderPath[index].id);
        setSpFolderPath(spFolderPath.slice(0, index + 1));
        setSelectedItems(new Map());
      },
      onProceedToSettings: proceedToSettings,
      onDisconnected: handleDisconnected,
      t,
    });

    return (
      <Dialog
        open={open ?? false}
        onOpenChange={onOpenChange ?? noop}
        title={t('microsoft365.title')}
        hideClose
        size="wide"
        className="gap-0 p-0 sm:p-0 md:p-0 md:pt-0 md:pb-0"
        bodyClassName="mx-0 my-0 px-0 py-0"
        customHeader={picker.customHeader}
      >
        {picker.content}
      </Dialog>
    );
  }

  if (stage === 'settings') {
    const settings = OneDriveSettingsStage({
      selectedItemCount: selectedItems.size,
      importType,
      isImporting: isBusy,
      teams: teams ?? undefined,
      isLoadingTeams,
      selectedTeamId: selectedTeamId_local,
      t,
      tCommon,
      onImportTypeChange: setImportType,
      onSelectTeam: handleSelectTeam,
      onBack: () => setStage('picker'),
      onImport: handleImport,
    });

    return (
      <Dialog
        open={open ?? false}
        onOpenChange={onOpenChange ?? noop}
        title={settings.title}
        description={settings.description}
        size="md"
        hideClose
        className="gap-0 p-0 sm:p-0 md:p-0 md:pt-0 md:pb-0"
        bodyClassName="mx-0 my-0 px-0 py-0"
        customHeader={settings.customHeader}
        footer={settings.footer}
        footerClassName={settings.footerClassName}
      >
        {settings.content}
      </Dialog>
    );
  }

  return undefined;
}
