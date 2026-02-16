export type OneDriveApiItem = {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType?: string;
  lastModified?: number;
  childCount?: number;
  webUrl?: string;
};

export type SharePointSite = {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
  description?: string;
};

export type SharePointDrive = {
  id: string;
  name: string;
  driveType: string;
  webUrl?: string;
  description?: string;
};

export type OneDriveSelectedItem = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
};

export type CollectedFile = {
  id: string;
  name: string;
  size: number;
  relativePath?: string;
  isDirectlySelected?: boolean;
  selectedParentId?: string;
  selectedParentName?: string;
  selectedParentPath?: string;
};

export type ImportType = 'one-time' | 'sync';
export type Stage = 'picker' | 'settings';
export type SourceTab = 'onedrive' | 'sharepoint';

export const isFolder = (item: OneDriveApiItem): boolean => item.isFolder;
export const isFile = (item: OneDriveApiItem): boolean => !item.isFolder;

export const getPathFromUrl = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
