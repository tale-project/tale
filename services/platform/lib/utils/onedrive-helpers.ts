import type { DriveItem } from '@/types/microsoft-graph';

/**
 * Utility functions for working with OneDrive files
 */

// File category types for type safety
type FileCategory = 'folder' | 'image' | 'document' | 'text' | 'other';

/**
 * Sanitize file path for storage
 * Removes or replaces invalid characters and ensures valid path format
 * Handles security concerns: path traversal, invalid characters, etc.
 */
export function sanitizeStoragePath(path: string): string {
  if (!path) return 'unnamed';

  try {
    // Step 1: Percent-decode the input to handle encoded characters
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      // Keep original if decoding fails
      decodedPath = path;
    }

    // Step 2: Normalize and split path into segments
    const segments = decodedPath
      .split(/[\/\\]+/) // Split on forward and back slashes
      .filter((segment) => {
        // Filter out empty segments, "." and ".." for security
        return segment && segment !== '.' && segment !== '..';
      })
      .map((segment) => {
        // Step 3: Replace invalid characters with underscores
        return segment.replace(/[^\w\-_.]/g, '_');
      });

    // Step 4: Join segments with single forward slashes
    let sanitizedPath = segments.join('/');

    // Step 5: Collapse repeated underscores and slashes
    sanitizedPath = sanitizedPath
      .replace(/_+/g, '_') // Collapse multiple underscores
      .replace(/\/+/g, '/'); // Collapse multiple slashes

    // Step 6: Trim leading/trailing dots and underscores
    sanitizedPath = sanitizedPath.replace(/^[_\.]+|[_\.]+$/g, '');

    // Step 7: Remove any leading slashes to prevent absolute paths
    sanitizedPath = sanitizedPath.replace(/^\/+/, '');

    // Step 8: Final security check - remove any remaining ".." patterns
    sanitizedPath = sanitizedPath.replace(/\.\./g, '');

    // Step 9: Enforce 255-character limit
    sanitizedPath = sanitizedPath.substring(0, 255);

    // Step 10: Return safe default if result is empty or only contains invalid chars
    if (!sanitizedPath || sanitizedPath.trim() === '') {
      return 'unnamed';
    }

    return sanitizedPath;
  } catch {
    // Fallback to safe default if any error occurs during sanitization
    return 'unnamed';
  }
}

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
 * Get file extension from a filename string
 * Handles edge cases: dotfiles, trailing dots, empty names
 */
function getExtension(name: string): string {
  if (!name) return '';

  const lastDotIndex = name.lastIndexOf('.');

  // No extension if:
  // - No dot found
  // - Dot is first character (dotfiles like .env, .gitignore)
  // - Dot is last character (names ending with dot)
  if (lastDotIndex <= 0 || lastDotIndex >= name.length - 1) {
    return '';
  }

  return name.substring(lastDotIndex + 1).toLowerCase();
}

/**
 * Get file extension from a drive item
 * Uses the centralized getExtension helper
 */
function getFileExtension(item: DriveItem): string {
  if (!isFile(item)) return '';
  return getExtension(item.name);
}

/**
 * Check if a file is a text file based on MIME type
 */
function isTextFile(item: DriveItem): boolean {
  if (!isFile(item) || !item.file?.mimeType) return false;

  const mimeType = item.file.mimeType.toLowerCase();

  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType.includes('xml') ||
    mimeType.includes('json')
  );
}

/**
 * Check if a file is an image
 */
function isImageFile(item: DriveItem): boolean {
  if (!isFile(item) || !item.file?.mimeType) return false;

  return item.file.mimeType.startsWith('image/');
}

/**
 * Check if a file is a document (Word, Excel, PowerPoint, PDF)
 */
function isDocumentFile(item: DriveItem): boolean {
  if (!isFile(item) || !item.file?.mimeType) return false;

  const mimeType = item.file.mimeType.toLowerCase();

  return (
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('pdf') ||
    mimeType === 'application/pdf' ||
    mimeType.includes('officedocument')
  );
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

/**
 * Format date in a readable format
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return (
    date.toLocaleDateString() +
    ' ' +
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  );
}

/**
 * Get file type category
 */
function getFileCategory(item: DriveItem): FileCategory {
  if (isFolder(item)) return 'folder';
  if (isImageFile(item)) return 'image';
  if (isDocumentFile(item)) return 'document';
  if (isTextFile(item)) return 'text';

  return 'other';
}

