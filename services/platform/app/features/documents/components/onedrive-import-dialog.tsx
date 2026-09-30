'use client';

import { Dialog } from '@tale/ui/dialog/dialog';
import { toast } from '@tale/ui/use-toast';
import {
  type RefObject,
  useMemo,
  useCallback,
  useState,
  useEffect,
} from 'react';

import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useImportOneDriveFiles } from '../hooks/actions';
import {
  useCloudImportAuthorizationStatus,
  useOneDriveFiles,
  useSharePointDrives,
  useSharePointFiles,
  useSharePointSites,
} from '../hooks/queries';
import { useCloudImportInteraction } from '../hooks/use-cloud-import-interaction';
import { useListingFailureToast } from '../hooks/use-listing-failure-toast';
import {
  readCloudImportAnswer,
  type CloudImportInterruption,
} from '../lib/cloud-import-outcome';
import { CloudListingError } from '../lib/cloud-listing-error';
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

/** A lapsed grant, in the words the doors answer it with — on a listing's
 *  error, or on an import's answer, which stopped where access ended. */
function isCloudImportAuthError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : undefined;
  if (message === undefined) return false;
  return (
    message.includes('Microsoft account not connected') ||
    message.includes('OneDrive is not authorized') ||
    message.includes('Cloud import is not authorized')
  );
}

interface OneDriveImportDialogProps {
  /** The hub folder the person had open. The import lands there instead of
   *  at the hub root, and a provider subfolder is mirrored underneath it. */
  destinationFolderId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  organizationId: string;
  onSuccess?: () => void;
  /** Hand off to the compact connect dialog — never shrink this wide picker.
   *  An import that access ended part-way passes how far it got. */
  onRequireConnect?: (interruption?: CloudImportInterruption) => void;
}

const noop = () => {};

export function OneDriveImportDialog({
  organizationId,
  destinationFolderId,
  onSuccess,
  onRequireConnect,
  open,
  onOpenChange,
  restoreFocusRef,
}: OneDriveImportDialogProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const captureInteraction = useCloudImportInteraction(
    open,
    organizationId,
    destinationFolderId,
  );

  const { mutateAsync: importFilesAction, isPending: isImporting } =
    useImportOneDriveFiles();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBusy = isImporting || isSubmitting;
  // The import's folder walk: a refused listing stops the import, which
  // reports it in its one failure toast.
  const { mutateAsync: listOneDriveFiles } = useBackendAction(
    'onedrive/actions:listFiles',
    { errorToast: false },
  );
  const { mutateAsync: listSharePointFiles } = useBackendAction(
    'onedrive/actions:listSharePointFiles',
    { errorToast: false },
  );

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');
  // The picker's team for a root-level import; a destination folder's own
  // audience wins over it (the server re-reads the landing folder).
  const [selectedTeamId_local, setSelectedTeamId_local] = useState<
    string | undefined
  >(undefined);

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

  const { teams, isLoading: isLoadingTeams } = useOrgTeams();

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

  // A dismissed import reports without replacing a newer picker.
  const handOffInterruptedImport = (
    interruption: CloudImportInterruption,
    isCurrentInteraction: boolean,
  ) => {
    if (isCurrentInteraction && onRequireConnect) {
      (onOpenChange ?? noop)(false);
      onRequireConnect(interruption);
      return;
    }
    toast({
      variant: interruption.imported > 0 ? 'warning' : 'destructive',
      title: t('onedrive.reconnect'),
      description: t('cloudImport.importInterrupted', {
        provider: 'Microsoft 365',
        imported: interruption.imported,
        total: interruption.total,
      }),
    });
  };

  const handleSelectTeam = useCallback((teamId: string | undefined) => {
    setSelectedTeamId_local(teamId);
  }, []);

  const isMicrosoftConnected =
    !cloudImportAuthLoading && cloudImportAuth?.status === 'active';

  const {
    data: oneDriveListing,
    isLoading: loading,
    error: loadError,
  } = useOneDriveFiles(
    organizationId,
    currentFolderId,
    stage === 'picker' && sourceTab === 'onedrive' && isMicrosoftConnected,
  );
  const itemsData = oneDriveListing?.items;
  // How many items the picker shows when the folder holds MORE than the
  // listing bound — null when the listing is whole.
  const oneDriveTruncatedCount = oneDriveListing?.truncated
    ? oneDriveListing.items.length
    : null;

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

  const {
    data: drivesData,
    isLoading: loadingDrives,
    error: drivesError,
  } = useSharePointDrives(
    organizationId,
    selectedSite?.id,
    stage === 'picker' &&
      sourceTab === 'sharepoint' &&
      !!selectedSite &&
      !selectedDrive &&
      isMicrosoftConnected,
  );

  const {
    data: spListing,
    isLoading: loadingSpFiles,
    error: spFilesError,
  } = useSharePointFiles(
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
  const spFilesData = spListing?.items;
  const spTruncatedCount = spListing?.truncated ? spListing.items.length : null;
  const listingTruncatedCount =
    sourceTab === 'sharepoint' ? spTruncatedCount : oneDriveTruncatedCount;

  // A listing that failed is reported once, after its retries; a lapsed
  // grant hands off to the connect dialog below instead.
  useListingFailureToast(
    loadError,
    t('onedrive.loadFailed'),
    isCloudImportAuthError,
  );
  useListingFailureToast(
    sitesError,
    t('onedrive.loadFailed'),
    isCloudImportAuthError,
  );
  useListingFailureToast(
    drivesError,
    t('onedrive.loadFailed'),
    isCloudImportAuthError,
  );
  useListingFailureToast(
    spFilesError,
    t('onedrive.loadFailed'),
    isCloudImportAuthError,
  );

  const isMicrosoftAccountError =
    (!cloudImportAuthLoading &&
      (!cloudImportAuth || cloudImportAuth.status !== 'active')) ||
    isCloudImportAuthError(loadError) ||
    isCloudImportAuthError(sitesError) ||
    isCloudImportAuthError(drivesError) ||
    isCloudImportAuthError(spFilesError);

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

        // A folder that cannot be listed whole cannot be imported whole:
        // stop here (the caller reports it) instead of importing the rest
        // and calling that a success. The provider's answer is for the log,
        // never for the toast.
        if (!folderResult.success || !folderResult.items) {
          throw new CloudListingError(
            folderResult.error || 'Failed to load the folder',
          );
        }
        if (folderResult.truncated) {
          throw new Error(
            t('onedrive.folderTooLargeToImport', { name: item.name }),
          );
        }

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
    const isCurrentInteraction = captureInteraction();
    setIsSubmitting(true);
    let started: { dismiss: () => void } | undefined;
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
      // Only empty folders were selected: there is nothing to send, and the
      // door would refuse an empty list in its own English.
      if (allFiles.length === 0) {
        toast({
          title:
            importType === 'one-time'
              ? t('onedrive.importFailed')
              : t('onedrive.syncFailed'),
          description: t('onedrive.noFilesSelected'),
          variant: 'destructive',
        });
        return;
      }

      started = toast({
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
        ...(destinationFolderId !== undefined && { destinationFolderId }),
      });

      const outcome = readCloudImportAnswer(result, isCloudImportAuthError);
      if (outcome.kind === 'interrupted') {
        started.dismiss();
        handOffInterruptedImport(outcome.interruption, isCurrentInteraction());
        return;
      }
      if (outcome.kind === 'completed') {
        toast({
          variant: 'success',
          title:
            importType === 'one-time'
              ? t('onedrive.importCompleted')
              : t('onedrive.syncCompleted'),
          description:
            importType === 'one-time'
              ? t('onedrive.filesImportedCount', {
                  count: outcome.imported,
                  total: outcome.total,
                })
              : t('onedrive.filesSyncedCount', {
                  count: outcome.imported,
                  total: outcome.total,
                }),
        });

        if (isCurrentInteraction()) {
          setSelectedItems(new Map());
          onSuccess?.();
        }
        return;
      }
      // What each file failed on is the backend's own English — often the
      // provider's raw answer: the log keeps it. The toast names the first
      // failed file only when its failure has words a person can read.
      console.warn(
        'OneDrive import did not complete:',
        result.error,
        result.results.filter((row) => row.status === 'error'),
      );
      const failedFile =
        outcome.failure === undefined
          ? undefined
          : t('cloudImport.failedFileDetail', {
              name: outcome.failure.name,
              reason: outcome.failure.reason,
            });
      if (outcome.kind === 'partial') {
        // Some files came in: a warning, never an error that hides them.
        toast({
          variant: 'warning',
          title:
            importType === 'one-time'
              ? t('cloudImport.importedPartial', {
                  imported: outcome.imported,
                  total: outcome.total,
                })
              : t('cloudImport.syncedPartial', {
                  imported: outcome.imported,
                  total: outcome.total,
                }),
          description: failedFile,
        });
        return;
      }
      toast({
        variant: 'destructive',
        title:
          importType === 'one-time'
            ? t('onedrive.importFailed')
            : t('onedrive.syncFailed'),
        description:
          failedFile ??
          (importType === 'one-time'
            ? t('onedrive.filesImportedCount', {
                count: 0,
                total: outcome.total,
              })
            : t('onedrive.filesSyncedCount', {
                count: 0,
                total: outcome.total,
              })),
      });
    } catch (error) {
      // Access that ended while the selected folders were listed: nothing
      // was imported yet. Only the current picker hands off to Reconnect.
      if (isCloudImportAuthError(error)) {
        console.warn('OneDrive import stopped: access ended.');
        started?.dismiss();
        handOffInterruptedImport({ imported: 0 }, isCurrentInteraction());
        return;
      }
      // A folder the provider would not list carries its raw answer, in
      // English: the log keeps it, and the toast says only that the import
      // failed. A refusal keeps its words, and so does a folder too large
      // to import whole.
      const unworded = error instanceof CloudListingError;
      if (unworded) {
        console.warn('OneDrive import listing failed:', error.message);
      } else {
        console.error('Failed to import from OneDrive:', error);
      }

      toast({
        title:
          importType === 'one-time'
            ? t('onedrive.importFailed')
            : t('onedrive.syncFailed'),
        description: unworded
          ? tCommon('errors.generic')
          : (failureDetail(error) ?? tCommon('errors.generic')),
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
      listingTruncatedCount,
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
        restoreFocusRef={restoreFocusRef}
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
        restoreFocusRef={restoreFocusRef}
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
