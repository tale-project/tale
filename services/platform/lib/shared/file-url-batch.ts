import { MAX_FILE_URL_IDS } from './file-types';

/**
 * Dedupe storage ids for `getFileUrls`. Fail loud past the Convex concurrent-IO
 * safety ceiling — never silently truncate.
 */
export function prepareFileUrlIds<T>(
  fileIds: readonly T[],
  toKey: (id: T) => string = (id) => String(id),
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const fileId of fileIds) {
    const key = toKey(fileId);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fileId);
  }
  if (unique.length > MAX_FILE_URL_IDS) {
    throw new Error(
      `getFileUrls: ${unique.length} unique file ids exceeds the ` +
        `${MAX_FILE_URL_IDS} concurrent-IO safety ceiling`,
    );
  }
  return unique;
}
