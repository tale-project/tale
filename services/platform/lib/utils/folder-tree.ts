/**
 * File-system-style folder navigation over a flat item list. Each item exposes
 * a '/'-joined folder path (e.g. 'github/issues'); given the current folder,
 * `buildFolderView` returns the immediate child folders (with nested counts)
 * and the items that live directly in the current folder. Used by the agents
 * list to drill in and out of arbitrarily nested folders — like a file
 * explorer.
 */

interface FolderRow {
  /** Last path segment — what the folder row shows. */
  name: string;
  /** Full '/'-joined path, used to drill into the folder. */
  path: string;
  /** Total items nested anywhere under this folder (direct + deeper). */
  count: number;
}

interface FolderView<T> {
  /** Immediate child folders of the current folder, sorted by name. */
  subfolders: FolderRow[];
  /** Items that live directly in the current folder. */
  items: T[];
  /** Current folder path split into segments (for a breadcrumb). */
  segments: string[];
}

/** Collapse leading/trailing/duplicate/blank segments in a folder path. */
export function normalizeFolderPath(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

/** True when `path` is the current folder or nested anywhere beneath it. */
export function isInFolder(path: string, currentFolder: string): boolean {
  const target = normalizeFolderPath(currentFolder);
  if (!target) return true;
  const p = normalizeFolderPath(path);
  return p === target || p.startsWith(`${target}/`);
}

export function buildFolderView<T>(
  items: readonly T[],
  getFolderPath: (item: T) => string,
  currentFolder: string,
): FolderView<T> {
  const current = normalizeFolderPath(currentFolder);
  const prefix = current ? `${current}/` : '';
  const here: T[] = [];
  const childCounts = new Map<string, number>();

  for (const item of items) {
    const folderPath = normalizeFolderPath(getFolderPath(item));
    if (folderPath === current) {
      here.push(item);
      continue;
    }
    // Only items nested under the current folder seed its child folders.
    if (current && !folderPath.startsWith(prefix)) continue;
    const rest = current ? folderPath.slice(prefix.length) : folderPath;
    const nextSegment = rest.split('/')[0];
    if (!nextSegment) continue;
    const childPath = current ? `${current}/${nextSegment}` : nextSegment;
    childCounts.set(childPath, (childCounts.get(childPath) ?? 0) + 1);
  }

  const subfolders: FolderRow[] = [...childCounts.entries()]
    .map(([path, count]) => ({
      path,
      name: path.split('/').at(-1) ?? path,
      count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    subfolders,
    items: here,
    segments: current ? current.split('/') : [],
  };
}
