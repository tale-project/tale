'use client';

import { Home } from 'lucide-react';
import { type ReactNode } from 'react';

import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type {
  OneDriveApiItem,
  OneDriveSelectedItem,
  SharePointSite,
  SharePointDrive,
  SourceTab,
} from './types';

import { OneDriveFileTable } from './onedrive-file-table';
import { SharePointDrivesTable } from './sharepoint-drives-table';
import { SharePointSitesTable } from './sharepoint-sites-table';

function SourceTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

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
}: OneDrivePickerStageProps) {
  const { t } = useT('documents');

  return {
    customHeader: (
      <div className="border-border border-b">
        <div className="px-6 pt-6 pb-4">
          <SectionHeader
            title={t('microsoft365.title')}
            description={t('microsoft365.selectDescription')}
          />
        </div>
        <HStack gap={0} className="px-6">
          <SourceTabButton
            active={sourceTab === 'onedrive'}
            onClick={() => onTabChange('onedrive')}
            icon={<OneDriveIcon className="size-4" />}
            label={t('microsoft365.myOneDrive')}
          />
          <SourceTabButton
            active={sourceTab === 'sharepoint'}
            onClick={() => onTabChange('sharepoint')}
            icon={<SharePointIcon className="size-4" />}
            label={t('microsoft365.sharePointSites')}
          />
        </HStack>
      </div>
    ),
    content: (
      <Stack gap={4} className="px-6 py-4">
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
                size="sm"
                onClick={onProceedToSettings}
                disabled={selectedItems.size === 0}
                className="px-6 whitespace-nowrap"
              >
                {t('onedrive.importCount', { count: selectedItems.size })}
              </Button>
            </HStack>

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

        {sourceTab === 'sharepoint' && (
          <>
            <SharePointBreadcrumb
              selectedSite={selectedSite}
              selectedDrive={selectedDrive}
              spFolderPath={spFolderPath}
              onSiteReset={onSpSiteReset}
              onDriveReset={onSpDriveReset}
              onBreadcrumbReset={onSpBreadcrumbReset}
              onFolderBreadcrumbClick={onSpFolderBreadcrumbClick}
            />

            {!selectedSite && (
              <div className="h-[500px] overflow-y-auto">
                <SharePointSitesTable
                  sites={sitesData || []}
                  isLoading={loadingSites}
                  onSiteClick={onSiteClick}
                />
              </div>
            )}

            {selectedSite && !selectedDrive && (
              <div className="h-[500px] overflow-y-auto">
                <SharePointDrivesTable
                  drives={drivesData || []}
                  isLoading={loadingDrives}
                  onDriveClick={onDriveClick}
                />
              </div>
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
                    size="sm"
                    onClick={onProceedToSettings}
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
                    handleFolderClick={onSpFolderClick}
                    buildItemPath={buildItemPath}
                  />
                </div>
              </>
            )}
          </>
        )}
      </Stack>
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
            <span className="text-foreground">{selectedDrive.name}</span>
          )}
        </>
      ) : (
        <span className="text-foreground">{selectedSite.displayName}</span>
      )}
    </HStack>
  );
}
