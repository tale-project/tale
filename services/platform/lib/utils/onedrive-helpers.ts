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

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

