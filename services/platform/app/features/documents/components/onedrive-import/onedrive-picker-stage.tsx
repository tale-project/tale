'use client';

import { Button } from '@tale/ui/button';
import { Stack, HStack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import { Home } from 'lucide-react';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';

import { MicrosoftDisconnectButton } from '../microsoft-disconnect-button';
import { MicrosoftReauthButton } from '../microsoft-reauth-button';
import { OneDriveFileTable } from './onedrive-file-table';
import { SharePointDrivesTable } from './sharepoint-drives-table';
import { SharePointSitesTable } from './sharepoint-sites-table';
import type {
  OneDriveApiItem,
  OneDriveSelectedItem,
  SharePointSite,
  SharePointDrive,
  SourceTab,
} from './types';

interface OneDrivePickerStageProps {
  sourceTab: SourceTab;
  searchQuery: string;
  selectedItems: Map<string, OneDriveSelectedItem>;
  filteredItems: OneDriveApiItem[];
  loading: boolean;
  isMicrosoftAccountError: boolean;
  folderPath: Array<{ id: string | undefined; name: string }>;
  sitesData: SharePointSite[] | undefined;
  loadingSites: boolean;
  drivesData: SharePointDrive[] | undefined;
  loadingDrives: boolean;
  loadingSpFiles: boolean;
  currentItems: OneDriveApiItem[];
  selectedSite: SharePointSite | null;
  selectedDrive: SharePointDrive | null;
  spFolderPath: Array<{ id: string | undefined; name: string }>;
  getSelectAllState: () => boolean | 'indeterminate';
  handleSelectAllChange: (checked: boolean | 'indeterminate') => void;
  getCheckedState: (item: OneDriveSelectedItem) => boolean;
  handleCheckChange: (itemId: string, isSelected: boolean) => void;
  handleFolderClick: (folder: OneDriveApiItem) => void;
  buildItemPath: (item: OneDriveApiItem) => string;
  onTabChange: (tab: SourceTab) => void;
  onSearchChange: (query: string) => void;
  onBreadcrumbClick: (index: number) => void;
  onSiteClick: (site: SharePointSite) => void;
  onDriveClick: (drive: SharePointDrive) => void;
  onSpFolderClick: (folder: OneDriveApiItem) => void;
  onSpBreadcrumbReset: () => void;
  onSpSiteReset: () => void;
  onSpDriveReset: () => void;
  onSpFolderBreadcrumbClick: (index: number) => void;
  onProceedToSettings: () => void;
  onDisconnected?: () => void;
  /** `documents`-namespace translator, owned by the dialog. This stage is a
   *  plain function (not a component), so it must not call hooks itself —
   *  the picker↔settings switch would change the parent's hook count. */
  t: TFunction;
}

export function OneDrivePickerStage({
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
  onTabChange,
  onSearchChange,
  onBreadcrumbClick,
  onSiteClick,
  onDriveClick,
  onSpFolderClick,
  onSpBreadcrumbReset,
  onSpSiteReset,
  onSpDriveReset,
  onSpFolderBreadcrumbClick,
  onProceedToSettings,
  onDisconnected,
  t,
}: OneDrivePickerStageProps) {
  return {
    customHeader: (
      <div className="border-border border-b">
        <div className="px-8 pt-5 pb-3">
          <SectionHeader
            title={
              isMicrosoftAccountError
                ? t('onedrive.microsoftNotConnected')
                : t('microsoft365.title')
            }
            description={
              isMicrosoftAccountError
                ? undefined
                : t('microsoft365.selectDescription')
            }
            action={
              isMicrosoftAccountError ? undefined : (
                <MicrosoftDisconnectButton onDisconnected={onDisconnected} />
              )
            }
          />
        </div>
        {!isMicrosoftAccountError && (
          <div className="px-8">
            <Tabs
              variant="underline"
              value={sourceTab}
              onValueChange={(v) => {
                if (v === 'onedrive' || v === 'sharepoint') onTabChange(v);
              }}
              items={[
                {
                  value: 'onedrive',
                  label: (
                    <span className="flex items-center gap-2">
                      <OneDriveIcon className="size-4" />
                      {t('microsoft365.myOneDrive')}
                    </span>
                  ),
                },
                {
                  value: 'sharepoint',
                  label: (
                    <span className="flex items-center gap-2">
                      <SharePointIcon className="size-4" />
                      {t('microsoft365.sharePointSites')}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>
    ),
    content: isMicrosoftAccountError ? (
      <Stack gap={3} className="items-center px-8 py-8 text-center">
        <MicrosoftIcon className="size-8" />
        <Text as="div" variant="muted" className="max-w-sm">
          {t('onedrive.microsoftNotConnectedDescription')}
        </Text>
        <MicrosoftReauthButton />
      </Stack>
    ) : (
      <div className="flex flex-col gap-3 px-8 pt-3 pb-6">
        {sourceTab === 'onedrive' && (
          <>
            {folderPath.length > 1 && (
              <HStack gap={2} className="text-muted-foreground text-sm">
                {folderPath.map((folder, index) => (
                  <HStack key={folder.id || 'root'} gap={2}>
                    <button
                      type="button"
                      onClick={() => onBreadcrumbClick(index)}
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
                onChange={(e) => onSearchChange(e.target.value)}
                wrapperClassName="flex-1"
              />
              <Button
                onClick={onProceedToSettings}
                disabled={selectedItems.size === 0}
                className="whitespace-nowrap"
              >
                {t('onedrive.importCount', { count: selectedItems.size })}
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
          </>
        )}

        {sourceTab === 'sharepoint' && (
          <>
            {selectedSite && (
              <SharePointBreadcrumb
                selectedSite={selectedSite}
                selectedDrive={selectedDrive}
                spFolderPath={spFolderPath}
                onSiteReset={onSpSiteReset}
                onDriveReset={onSpDriveReset}
                onBreadcrumbReset={onSpBreadcrumbReset}
                onFolderBreadcrumbClick={onSpFolderBreadcrumbClick}
              />
            )}

            {!selectedSite && (
              <SharePointSitesTable
                sites={sitesData || []}
                isLoading={loadingSites}
                onSiteClick={onSiteClick}
              />
            )}

            {selectedSite && !selectedDrive && (
              <SharePointDrivesTable
                drives={drivesData || []}
                isLoading={loadingDrives}
                onDriveClick={onDriveClick}
              />
            )}

            {selectedSite && selectedDrive && (
              <>
                <HStack gap={3}>
                  <SearchInput
                    placeholder={t('searchFilesAndFolders')}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    wrapperClassName="flex-1"
                  />
                  <Button
                    onClick={onProceedToSettings}
                    disabled={selectedItems.size === 0}
                    className="whitespace-nowrap"
                  >
                    {t('onedrive.importCount', { count: selectedItems.size })}
                  </Button>
                </HStack>
                <OneDriveFileTable
                  items={currentItems}
                  isLoading={loadingSpFiles}
                  searchQuery={searchQuery}
                  selectedItems={selectedItems}
                  getSelectAllState={getSelectAllState}
                  handleSelectAllChange={handleSelectAllChange}
                  getCheckedState={getCheckedState}
                  handleCheckChange={handleCheckChange}
                  handleFolderClick={onSpFolderClick}
                  buildItemPath={buildItemPath}
                />
              </>
            )}
          </>
        )}
      </div>
    ),
  };
}

function SharePointBreadcrumb({
  selectedSite,
  selectedDrive,
  spFolderPath,
  onSiteReset,
  onDriveReset,
  onBreadcrumbReset,
  onFolderBreadcrumbClick,
}: {
  selectedSite: SharePointSite | null;
  selectedDrive: SharePointDrive | null;
  spFolderPath: Array<{ id: string | undefined; name: string }>;
  onSiteReset: () => void;
  onDriveReset: () => void;
  onBreadcrumbReset: () => void;
  onFolderBreadcrumbClick: (index: number) => void;
}) {
  const { t } = useT('documents');

  if (!selectedSite) return null;

  return (
    <HStack gap={2} className="text-muted-foreground text-sm">
      <button
        type="button"
        onClick={onSiteReset}
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
            onClick={onDriveReset}
            className="hover:text-blue-600 hover:underline"
          >
            {selectedSite.displayName}
          </button>
          <span>/</span>
          {spFolderPath.length > 0 ? (
            <>
              <button
                type="button"
                onClick={onBreadcrumbReset}
                className="hover:text-blue-600 hover:underline"
              >
                {selectedDrive.name}
              </button>
              {spFolderPath.map((folder, index) => (
                <HStack key={folder.id || index} gap={2}>
                  <span>/</span>
                  <button
                    type="button"
                    onClick={() => onFolderBreadcrumbClick(index)}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {folder.name}
                  </button>
                </HStack>
              ))}
            </>
          ) : (
            <Text as="span" variant="body">
              {selectedDrive.name}
            </Text>
          )}
        </>
      ) : (
        <Text as="span" variant="body">
          {selectedSite.displayName}
        </Text>
      )}
    </HStack>
  );
}
