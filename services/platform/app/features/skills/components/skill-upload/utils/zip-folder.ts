import JSZip from 'jszip';

import {
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_FILES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
} from '@/lib/shared/schemas/skills';

import type { ParseError } from './parse-skill-bundle';

export type ZipFolderResult =
  | { success: true; zipFile: File }
  | { success: false; error: ParseError };

function refusal(
  key: string,
  params?: Record<string, string | number>,
): ZipFolderResult {
  return { success: false, error: { key: `upload.errors.${key}`, params } };
}

const OS_METADATA_BASENAMES = new Set(['.DS_Store', 'Thumbs.db']);

/**
 * Turn a folder pick (`webkitdirectory` input) into the same zip the drop
 * zone accepts, so both paths converge before validation and upload. Each
 * file keeps its `webkitRelativePath` verbatim — that includes the picked
 * folder as a single wrapper, which the bundle parser's wrapper-strip
 * already handles. Guards mirror the parser's caps so an oversized pick
 * fails before any zipping work.
 */
export async function zipFolderSelection(
  files: readonly File[],
): Promise<ZipFolderResult> {
  const entries = files.filter((file) => {
    const basename = file.name;
    return !OS_METADATA_BASENAMES.has(basename);
  });
  if (entries.length === 0) {
    return refusal('emptyZip');
  }
  if (entries.length > MAX_SKILL_BUNDLE_FILES) {
    return refusal('tooManyEntries', {
      count: entries.length,
      max: MAX_SKILL_BUNDLE_FILES,
    });
  }

  const zip = new JSZip();
  let totalBytes = 0;
  let topFolder: string | null = null;
  for (const file of entries) {
    const relPath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    if (file.size > MAX_SKILL_BUNDLE_FILE_BYTES) {
      return refusal('assetTooLarge', {
        path: relPath,
        max: `${Math.round(MAX_SKILL_BUNDLE_FILE_BYTES / 1024)} KB`,
      });
    }
    totalBytes += file.size;
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      return refusal('totalTooLarge', {
        max: `${Math.round(MAX_SKILL_BUNDLE_TOTAL_BYTES / 1024 / 1024)} MB`,
      });
    }
    zip.file(relPath, await file.arrayBuffer());
    if (topFolder === null) {
      topFolder = relPath.split('/')[0] ?? 'skill';
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    success: true,
    zipFile: new File([blob], `${topFolder ?? 'skill'}.zip`, {
      type: 'application/zip',
    }),
  };
}
