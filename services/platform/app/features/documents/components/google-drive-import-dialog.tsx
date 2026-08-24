'use client';

import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { Home } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { GoogleIcon } from '@/app/components/icons/google-icon';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useImportGoogleDriveFiles } from '../hooks/actions';
import {
  useCloudImportAuthorizationStatus,
  useGoogleDriveFiles,
} from '../hooks/queries';
import { GoogleDisconnectButton } from './google-disconnect-button';
import { GoogleReauthButton } from './google-reauth-button';
import { OneDriveFileTable } from './onedrive-import/onedrive-file-table';
import { OneDriveSettingsStage } from './onedrive-import/onedrive-settings-stage';
import type {
  CollectedFile,
  ImportType,
  OneDriveApiItem,
  OneDriveSelectedItem,
  Stage,
} from './onedrive-import/types';
import { isFile, isFolder } from './onedrive-import/types';

function isCloudImportAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Google Drive is not authorized') ||
    error.message.includes('Cloud import is not authorized')
  );
}

const noop = () => {};

interface GoogleDriveImportDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  organizationId: string;
  onSuccess?: () => void;
}

export function GoogleDriveImportDialog({
  organizationId,
  onSuccess,
  ...props
}: GoogleDriveImportDialogProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const { selectedTeamId } = useTeamFilter();

  const { mutateAsync: importFilesAction, isPending: isImporting } =
    useImportGoogleDriveFiles();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBusy = isImporting || isSubmitting;
  const { mutateAsync: listGoogleDriveFiles } = useConvexAction(
    api.google_drive.actions.listFiles,
  );

  const [stage, setStage] = useState<Stage>('picker');
  const [importType, setImportType] = useState<ImportType>('one-time');
  const [selectedTeamIdLocal, setSelectedTeamIdLocal] = useState<
    string | undefined
  >(() => selectedTeamId ?? undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState(
    new Map<string, OneDriveSelectedItem>(),
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string | undefined; name: string }>
  >([{ id: undefined, name: t('breadcrumb.googleDrive') }]);

  const { teams, isLoading: isLoadingTeams } = useTeams();

  const { data: cloudImportAuth, isLoading: cloudImportAuthLoading } =
    useCloudImportAuthorizationStatus(
      organizationId,
      props.open === true,
      'google-drive',
    );

  const isGoogleConnected =
    !cloudImportAuthLoading && cloudImportAuth?.status === 'active';

  const {
    data: itemsData,
    isLoading: loading,
    error: loadError,
  } = useGoogleDriveFiles(
    organizationId,
    currentFolderId,
    stage === 'picker' && isGoogleConnected,
  );

  const isGoogleAccountError =
    (!cloudImportAuthLoading &&
      (!cloudImportAuth || cloudImportAuth.status !== 'active')) ||
    isCloudImportAuthError(loadError);

  const currentItems = useMemo(
    () => (itemsData as OneDriveApiItem[] | undefined) ?? [],
    [itemsData],
  );

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return currentItems;
    const q = searchQuery.toLowerCase();
    return currentItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [currentItems, searchQuery]);

  const handleDisconnected = useCallback(() => {
    setSelectedItems(new Map());
    setSearchQuery('');
    setCurrentFolderId(undefined);
    setFolderPath([{ id: undefined, name: t('breadcrumb.googleDrive') }]);
    setStage('picker');
  }, [t]);

  const buildItemPath = (item: OneDriveApiItem): string => {
    const pathParts: string[] = [];
    folderPath.forEach((folder) => {
      if (folder.id) pathParts.push(folder.id);
    });
    pathParts.push(item.id);
    return pathParts.join('/');
  };

  const getCheckedState = (item: OneDriveSelectedItem): boolean =>
    selectedItems.has(item.id);

  const handleCheckChange = (itemId: string, isSelected: boolean) => {
    const next = new Map(selectedItems);
    if (isSelected) {
      const data = currentItems.find((i) => i.id === itemId);
      if (data) {
        next.set(itemId, {
          id: data.id,
          name: data.name,
          path: buildItemPath(data),
          type: isFolder(data) ? 'folder' : 'file',
          size: data.size,
        });
      }
    } else {
      next.delete(itemId);
    }
    setSelectedItems(next);
  };

  const getSelectAllState = (): boolean | 'indeterminate' => {
    if (filteredItems.length === 0) return false;
    const selectedCount = filteredItems.filter((i) =>
      selectedItems.has(i.id),
    ).length;
    if (selectedCount === 0) return false;
    if (selectedCount === filteredItems.length) return true;
    return 'indeterminate';
  };

  const handleSelectAllChange = (checked: boolean | 'indeterminate') => {
    const next = new Map(selectedItems);
    if (checked === true) {
      for (const item of filteredItems) {
        next.set(item.id, {
          id: item.id,
          name: item.name,
          path: buildItemPath(item),
          type: isFolder(item) ? 'folder' : 'file',
          size: item.size,
        });
      }
    } else {
      for (const item of filteredItems) next.delete(item.id);
    }
    setSelectedItems(next);
  };

  const handleFolderClick = (folder: OneDriveApiItem) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    setSelectedItems(new Map());
    setSearchQuery('');
  };

  const handleBreadcrumbClick = (index: number) => {
    setFolderPath(folderPath.slice(0, index + 1));
    setCurrentFolderId(folderPath[index].id);
    setSelectedItems(new Map());
    setSearchQuery('');
  };

  const collectAllFiles = async (
    items: OneDriveApiItem[],
    currentPath = '',
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
          const folderResult = await listGoogleDriveFiles({
            organizationId,
            folderId: item.id,
          });
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
              folderResult.items as OneDriveApiItem[],
              folderPathStr,
              directlySelectedItems,
              parentInfoForSubFiles,
            );
            allFiles.push(...subFiles);
          }
        } catch (error) {
          console.error(error);
          toast({
            title: t('googledrive.loadFailed'),
            variant: 'destructive',
          });
        }
      }
    }
    return allFiles;
  };

  const proceedToSettings = () => {
    if (selectedItems.size === 0) return;
    setStage('settings');
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    try {
      const selectedList = Array.from(selectedItems.values());
      const directlySelectedIds = new Set(selectedList.map((i) => i.id));
      const seedItems: OneDriveApiItem[] = selectedList.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size ?? 0,
        isFolder: item.type === 'folder',
      }));

      const allFiles = await collectAllFiles(
        seedItems,
        '',
        directlySelectedIds,
        null,
      );
      if (allFiles.length === 0) {
        toast({
          title:
            importType === 'one-time'
              ? t('googledrive.importFailed')
              : t('googledrive.syncFailed'),
          description: t('googledrive.noFilesSelected'),
          variant: 'destructive',
        });
        return;
      }

      toast({
        title:
          importType === 'one-time'
            ? t('googledrive.importStarted')
            : t('googledrive.syncStarted'),
        description:
          importType === 'one-time'
            ? t('googledrive.importingItems', { count: allFiles.length })
            : t('googledrive.syncingItems', { count: allFiles.length }),
      });

      const result = await importFilesAction({
        organizationId,
        importType,
        teamId: selectedTeamIdLocal,
        items: allFiles,
      });

      if (result.success) {
        toast({
          variant: 'success',
          title:
            importType === 'one-time'
              ? t('googledrive.importCompleted')
              : t('googledrive.syncCompleted'),
          description:
            importType === 'one-time'
              ? t('googledrive.filesImportedCount', {
                  count: result.successCount,
                  total: result.totalFiles,
                })
              : t('googledrive.filesSyncedCount', {
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
              ? t('googledrive.importFailed')
              : t('googledrive.syncFailed'),
          description: result.error || tCommon('errors.generic'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Failed to import from Google Drive:', error);
      toast({
        title:
          importType === 'one-time'
            ? t('googledrive.importFailed')
            : t('googledrive.syncFailed'),
        description:
          error instanceof Error ? error.message : tCommon('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (stage === 'picker') {
    return (
      <Dialog
        open={props.open ?? false}
        onOpenChange={props.onOpenChange ?? noop}
        title={t('googledrive.title')}
        hideClose
        size="wide"
        className="gap-0 p-0 sm:p-0 md:p-0 md:pt-0 md:pb-0"
        bodyClassName="mx-0 my-0 px-0 py-0"
        customHeader={
          <div className="border-border border-b">
            <div className="px-8 pt-5 pb-3">
              <SectionHeader
                title={
                  isGoogleAccountError
                    ? t('googledrive.notConnected')
                    : t('googledrive.title')
                }
                description={
                  isGoogleAccountError
                    ? undefined
                    : t('googledrive.selectDescription')
                }
                action={
                  isGoogleAccountError ? undefined : (
                    <GoogleDisconnectButton
                      onDisconnected={handleDisconnected}
                    />
                  )
                }
              />
            </div>
          </div>
        }
      >
        {isGoogleAccountError ? (
          <Stack gap={3} className="items-center px-8 py-8 text-center">
            <GoogleIcon className="size-8" />
            <Text as="div" variant="muted" className="max-w-sm">
              {t('googledrive.notConnectedDescription')}
            </Text>
            <GoogleReauthButton />
          </Stack>
        ) : (
          <div className="flex flex-col gap-3 px-8 pt-3 pb-6">
            {folderPath.length > 1 && (
              <HStack gap={2} className="text-muted-foreground text-sm">
                {folderPath.map((folder, index) => (
                  <HStack key={folder.id || 'root'} gap={2}>
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

            <HStack gap={3}>
              <SearchInput
                placeholder={t('searchFilesAndFolders')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                wrapperClassName="flex-1"
              />
              <Button
                onClick={proceedToSettings}
                disabled={selectedItems.size === 0}
                className="whitespace-nowrap"
              >
                {t('googledrive.importCount', { count: selectedItems.size })}
              </Button>
            </HStack>

            <OneDriveFileTable
              items={filteredItems}
              isLoading={loading}
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
        )}
      </Dialog>
    );
  }

  const settings = OneDriveSettingsStage({
    selectedItemCount: selectedItems.size,
    importType,
    isImporting: isBusy,
    teams: teams ?? undefined,
    isLoadingTeams,
    selectedTeamId: selectedTeamIdLocal,
    t,
    tCommon,
    messagePrefix: 'googledrive',
    onImportTypeChange: setImportType,
    onSelectTeam: setSelectedTeamIdLocal,
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
