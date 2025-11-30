// Centralized storage constants and helpers for building storage queries
// Avoid hardcoding provider-specific prefixes in services

export const ONEDRIVE_STORAGE_ROOT_PREFIX = 'onedrive-sync';

/**
 * Build a storage path filter for a given folder prefix.
 * Ensures a trailing '/%'. If no prefix provided, uses the OneDrive root prefix.
 */
export function buildStoragePrefixFilter(prefix?: string): string {
  const base = (prefix ?? ONEDRIVE_STORAGE_ROOT_PREFIX).replace(/\/$/, '');
  return `${base}/%`;
}
