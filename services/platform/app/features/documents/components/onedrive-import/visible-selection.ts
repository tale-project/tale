import type { OneDriveApiItem, OneDriveSelectedItem } from './types';
import { isFolder } from './types';

// The cloud pickers' header box (Google Drive, OneDrive, a SharePoint
// library) speaks for the rows on screen — the folder's listing, narrowed by
// the search — and for nothing else. A file selected under an earlier search
// stays selected when the box is cleared, as it does when another row's own
// box is: Microsoft's box once added the rows on screen but cleared the whole
// selection, dropping such a file unseen.

/** Checked when every row on screen is selected, mixed when some are. */
export function visibleSelectionState(
  visible: readonly OneDriveApiItem[],
  selected: ReadonlyMap<string, OneDriveSelectedItem>,
): boolean | 'indeterminate' {
  if (visible.length === 0) return false;
  const selectedCount = visible.filter((item) => selected.has(item.id)).length;
  if (selectedCount === 0) return false;
  if (selectedCount === visible.length) return true;
  return 'indeterminate';
}

/** The selection after the header box changes: checking adds the rows on
 *  screen, clearing removes those rows alone. Radix reports a click on a
 *  mixed box as `true`, so a mixed box selects the rest. */
export function toggleVisibleSelection(
  selected: ReadonlyMap<string, OneDriveSelectedItem>,
  visible: readonly OneDriveApiItem[],
  checked: boolean | 'indeterminate',
  buildItemPath: (item: OneDriveApiItem) => string,
): Map<string, OneDriveSelectedItem> {
  const next = new Map(selected);
  if (checked === true) {
    for (const item of visible) {
      next.set(item.id, {
        id: item.id,
        name: item.name,
        path: buildItemPath(item),
        type: isFolder(item) ? 'folder' : 'file',
        size: item.size,
      });
    }
  } else {
    for (const item of visible) next.delete(item.id);
  }
  return next;
}
