import JSZip from 'jszip';

export interface ParsedEntry {
  /**
   * Relative path of the entry as it appears in the upload. For folder picks
   * (`webkitdirectory`) this includes the chosen folder name as the first
   * segment so the resulting slug groups files under that folder. Zip
   * archives strip a single common root folder if every entry shares one.
   * Example: `contracts/red-flag-dd.json`.
   */
  relPath: string;
  /** Last path segment with the `.json` extension stripped. */
  baseName: string;
  /** Parsed JSON value. Undefined when `error` is set. */
  json?: unknown;
  /** Human-readable failure reason when this entry could not be parsed. */
  error?: string;
}

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function stripJsonExt(name: string): string {
  return name.replace(/\.json$/i, '');
}

function lastSegment(relPath: string): string {
  const parts = relPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? relPath;
}

function trimRoot(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.join('/');
}

async function parseJsonFile(
  file: File,
  relPath: string,
): Promise<ParsedEntry> {
  const baseName = stripJsonExt(lastSegment(relPath));
  try {
    const text = await file.text();
    return { relPath, baseName, json: JSON.parse(text) };
  } catch (err) {
    return {
      relPath,
      baseName,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    };
  }
}

async function parseZipFile(file: File): Promise<ParsedEntry[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    return [
      {
        relPath: file.name,
        baseName: stripJsonExt(file.name),
        error: err instanceof Error ? err.message : 'Invalid zip archive',
      },
    ];
  }

  const entries: ParsedEntry[] = [];
  const jsonEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.json'),
  );

  const commonRoot = detectCommonRoot(jsonEntries.map((e) => e.name));

  for (const entry of jsonEntries) {
    const trimmed = trimRoot(entry.name);
    const relPath = commonRoot
      ? trimmed.replace(new RegExp(`^${commonRoot}/`), '')
      : trimmed;
    const baseName = stripJsonExt(lastSegment(relPath));
    try {
      const text = await entry.async('string');
      entries.push({ relPath, baseName, json: JSON.parse(text) });
    } catch (err) {
      entries.push({
        relPath,
        baseName,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      });
    }
  }

  return entries;
}

/**
 * If every entry sits under the same first segment, return that segment.
 * Used to strip a wrapper folder that some zip producers (macOS Archive
 * Utility, `zip -r`) include around a folder selection.
 */
function detectCommonRoot(names: string[]): string | null {
  if (names.length === 0) return null;
  const firstSegments = names.map((n) => trimRoot(n).split('/')[0]);
  const head = firstSegments[0];
  if (!head) return null;
  if (firstSegments.every((seg) => seg === head)) {
    const hasNested = names.some(
      (n) => trimRoot(n).split('/').filter(Boolean).length > 1,
    );
    return hasNested ? head : null;
  }
  return null;
}

/**
 * Parse a list of files (from a file picker, folder picker, or drag-drop) into
 * a flat list of JSON entries. Folder uploads are detected via
 * `webkitRelativePath`. Zip files are extracted and their `.json` members are
 * included in the output. Non-JSON, non-zip files are reported as errors so
 * the caller can surface them to the user.
 */
export async function parseUploadedConfigs(
  files: File[],
): Promise<ParsedEntry[]> {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return files.map((file) => ({
      relPath: getRelPath(file),
      baseName: stripJsonExt(lastSegment(getRelPath(file))),
      error: `Upload exceeds ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit`,
    }));
  }

  const results: ParsedEntry[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const relPath = getRelPath(file);
    if (lower.endsWith('.zip')) {
      results.push(...(await parseZipFile(file)));
    } else if (lower.endsWith('.json')) {
      results.push(await parseJsonFile(file, relPath));
    } else {
      results.push({
        relPath,
        baseName: stripJsonExt(lastSegment(relPath)),
        error: 'Unsupported file type (expected .json or .zip)',
      });
    }
  }
  return results;
}

function getRelPath(file: File): string {
  const fromDir = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (fromDir && fromDir.length > 0) return trimRoot(fromDir);
  return file.name;
}
