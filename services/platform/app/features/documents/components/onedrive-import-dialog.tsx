'use client';

import { useMemo, useCallback, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

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

import { useImportOneDriveFiles } from '../hooks/actions';
import {
  useOneDriveFiles,
  useSharePointDrives,
  useSharePointFiles,
  useSharePointSites,
} from '../hooks/queries';
import { OneDrivePickerStage } from './onedrive-import/onedrive-picker-stage';
import { OneDriveSettingsStage } from './onedrive-import/onedrive-settings-stage';
import { isFolder, isFile } from './onedrive-import/types';

interface OneDriveImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

const noop = () => {};

export function OneDriveImportDialog({
  organizationId,
  onSuccess,
  ...props
}: OneDriveImportDialogProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  const { mutateAsync: importFilesAction, isPending: isImporting } =
    useImportOneDriveFiles();
  const { mutateAsync: listOneDriveFiles } = useConvexAction(
    api.onedrive.actions.listFiles,
  );
  const { mutateAsync: listSharePointFiles } = useConvexAction(
    api.onedrive.actions.listSharePointFiles,
  );

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(() =>
    selectedTeamId ? new Set([selectedTeamId]) : new Set(),
  );

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
  const [selectedItems, setSelectedItems] = useState<
    Map<string, OneDriveSelectedItem>
  >(new Map());
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([{ id: undefined, name: t('breadcrumb.oneDrive') }]);

  const { teams, isLoading: isLoadingTeams } = useTeams();

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

  const {
    data: itemsData,
    isLoading: loading,
    error: loadError,
  } = useOneDriveFiles(
    currentFolderId,
    stage === 'picker' && sourceTab === 'onedrive',
  );

  const { data: sitesData, isLoading: loadingSites } = useSharePointSites(
    stage === 'picker' && sourceTab === 'sharepoint' && !selectedSite,
  );

  const { data: drivesData, isLoading: loadingDrives } = useSharePointDrives(
    selectedSite?.id,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !selectedDrive,
  );

  const { data: spFilesData, isLoading: loadingSpFiles } = useSharePointFiles(
    selectedSite?.id,
    selectedDrive?.id,
    spFolderId,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !!selectedDrive,
  );

  const isMicrosoftAccountError =
    loadError instanceof Error &&
    loadError.message.includes('Microsoft account not connected');

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

      const teamTags =
        selectedTeams.size > 0 ? Array.from(selectedTeams) : undefined;

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
    }
  };

  if (stage === 'picker') {
    const picker = OneDrivePickerStage({
      sourceTab,
      searchQuery,
      selectedItems,
      filteredItems,
      loading,
      isMicrosoftAccountError,
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
    });

    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? noop}
        title={t('microsoft365.title')}
        hideClose
        className="max-w-5xl p-0 sm:p-0"
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
      isImporting,
      teams: teams ?? undefined,
      isLoadingTeams,
      selectedTeams,
      onImportTypeChange: setImportType,
      onToggleTeam: handleToggleTeam,
      onBack: () => setStage('picker'),
      onImport: handleImport,
    });

    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? noop}
        title={settings.title}
        description={settings.description}
        size="md"
        hideClose
        className="p-0 sm:p-0"
        customHeader={settings.customHeader}
        footer={settings.footer}
        footerClassName={settings.footerClassName}
      >
        {settings.content}
      </Dialog>
    );
  }
}
