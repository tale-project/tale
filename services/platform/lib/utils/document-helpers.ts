/**
 * Document utility functions
 */

/**
 * Get sync status from metadata and upload source
 * @param metadata - File metadata
 * @param uploadSource - Upload source type
 * @returns Sync status
 */
export function getSyncStatus(
  metadata: Record<string, any>,
  uploadSource?: string,
): string {
  const source = uploadSource || metadata.uploadSource;
  if (source === 'onedrive-sync') return 'synced';
  if (source === 'onedrive') return 'not_synced';
  if (source === 'manual') return 'not_synced';
  return 'unknown';
}

/**
 * Format file size in human readable format
 * @param sizeBytes - File size in bytes
 * @returns Formatted size string
 */
export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(sizeBytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = sizeBytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Get file extension from filename
 * @param filename - Name of the file
 * @returns File extension in uppercase
 */
export function getFileExtension(filename: string): string {
  try {
    // If it's a URL (absolute or relative), use URL APIs to safely strip query/hash
    const url = new URL(filename, 'http://local'); // base handles relative paths
    const pathname = url.pathname || '';
    const lastSegment = pathname.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  } catch {
    // Fallback: not a valid URL, treat as plain filename
    const clean = filename.split('?')[0].split('#')[0];
    const lastSegment = clean.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  }
}

/**
 * Determine file type category from extension
 * @param filename - Name of the file
 * @returns File type category
 */
export function getFileTypeCategory(
  filename: string,
): 'document' | 'image' | 'archive' | 'other' {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (!ext) return 'other';

  const documentExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];

  if (documentExts.includes(ext)) return 'document';
  if (imageExts.includes(ext)) return 'image';
  if (archiveExts.includes(ext)) return 'archive';

  return 'other';
}

/**
 * Get folder path from document metadata
 * @param metadata - File metadata object
 * @returns Folder path or fallback message
 */
export function getFolderPath(metadata: Record<string, any>): string {
  if (!metadata || typeof metadata !== 'object') return '—';

  // Try different possible path fields
  const pathFields = [
    'folderPath',
    'parentPath',
    'path',
    'folder_path',
    'parent_path',
    'originalPath',
  ];

  for (const field of pathFields) {
    const path = metadata[field];
    if (path && typeof path === 'string') {
      // Clean up the path - remove leading/trailing slashes and normalize
      const cleanPath = path.replace(/^\/+|\/+$/g, '');
      return cleanPath || '/';
    }
  }

  // If no path found, return dash
  return '—';
}

/**
 * Extract folder path from storage path as fallback
 * @param storagePath - Full storage path of the file
 * @returns Extracted folder path or fallback message
 */
export function extractPathFromStoragePath(storagePath: string): string {
  if (!storagePath || typeof storagePath !== 'string') return '—';

  // Remove the business ID prefix and filename to get the folder path
  // Example: "business123/one-time/onedrive/Documents/Projects/file.pdf" -> "Documents/Projects"
  const parts = storagePath.split('/');

  // Remove business ID (first part) and filename (last part)
  if (parts.length <= 3) return '/'; // No folder structure beyond source

  // Find where the actual folder structure starts (after business/type/source)
  let startIndex = 1;
  if (
    parts.length >= 3 &&
    (parts[1] === 'sync' || parts[1] === 'one-time') &&
    parts[2] === 'onedrive'
  ) {
    startIndex = 3; // Skip business/type/onedrive
  } else if (parts[0] === 'uploads') {
    startIndex = parts[1] === 'sync' || parts[1] === 'one-time' ? 3 : 2;
  }

  const folderParts = parts.slice(startIndex, -1); // Exclude filename

  if (folderParts.length === 0) return '/';

  return folderParts.join('/');
}
