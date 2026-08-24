/**
 * Derive Sync Targets - Pure mapping from the import dialog's payload to the
 * sync-config rows a "Sync import" must create.
 */

import type { ImportItem } from './import_files';

export interface SyncTarget {
  itemType: 'file' | 'folder';
  itemId: string;
  itemName: string;
  itemPath?: string;
}

/**
 * A folder selection arrives flattened: the payload contains the folder's
 * files, each carrying `selectedParent*` pointers back to the folder the user
 * actually ticked. One config per unique selected folder keeps the whole
 * folder syncing (new files included) instead of only the files that existed
 * at import time. Directly-selected files sync individually.
 */
export function deriveSyncTargets(items: ImportItem[]): SyncTarget[] {
  const targets = new Map<string, SyncTarget>();

  for (const item of items) {
    if (item.selectedParentId) {
      if (!targets.has(item.selectedParentId)) {
        targets.set(item.selectedParentId, {
          itemType: 'folder',
          itemId: item.selectedParentId,
          itemName: item.selectedParentName ?? '',
          itemPath: item.selectedParentPath ?? item.selectedParentName,
        });
      }
    } else if (item.isDirectlySelected) {
      targets.set(item.id, {
        itemType: 'file',
        itemId: item.id,
        itemName: item.name,
        itemPath: item.relativePath || item.name,
      });
    }
  }

  return [...targets.values()];
}
