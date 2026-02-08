import type { DriveItem } from '@/types/microsoft-graph';

/**
 * Utility functions for working with OneDrive files
 */

/**
 * Check if a drive item is a file
 */
export function isFile(item: DriveItem): boolean {
  return !!item.file && !item.folder;
}

/**
 * Check if a drive item is a folder
 */
export function isFolder(item: DriveItem): boolean {
  return !!item.folder && !item.file;
}

