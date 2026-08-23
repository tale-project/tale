import { describe, expect, it } from 'vitest';

import { deriveSyncTargets } from './derive_sync_targets';
import type { ImportItem } from './import_files';

const folderFile = (
  id: string,
  overrides: Partial<ImportItem> = {},
): ImportItem => ({
  id,
  name: `${id}.docx`,
  size: 10,
  relativePath: `Meetings/${id}.docx`,
  isDirectlySelected: false,
  selectedParentId: 'folder-meetings',
  selectedParentName: 'Meetings',
  selectedParentPath: 'Meetings',
  ...overrides,
});

describe('deriveSyncTargets', () => {
  it('collapses a selected folder to a single folder target', () => {
    const targets = deriveSyncTargets([folderFile('a'), folderFile('b')]);

    expect(targets).toEqual([
      {
        itemType: 'folder',
        itemId: 'folder-meetings',
        itemName: 'Meetings',
        itemPath: 'Meetings',
      },
    ]);
  });

  it('creates a file target for a directly selected file', () => {
    const targets = deriveSyncTargets([
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 5,
        relativePath: 'report.pdf',
        isDirectlySelected: true,
      },
    ]);

    expect(targets).toEqual([
      {
        itemType: 'file',
        itemId: 'file-1',
        itemName: 'report.pdf',
        itemPath: 'report.pdf',
      },
    ]);
  });

  it('mixes folder and file targets from one selection', () => {
    const targets = deriveSyncTargets([
      folderFile('a'),
      {
        id: 'file-1',
        name: 'report.pdf',
        size: 5,
        relativePath: 'report.pdf',
        isDirectlySelected: true,
      },
    ]);

    expect(targets.map((t) => t.itemId)).toEqual(['folder-meetings', 'file-1']);
  });

  it('ignores files that are neither directly selected nor in a selected folder', () => {
    expect(
      deriveSyncTargets([
        { id: 'x', name: 'x.txt', size: 1, isDirectlySelected: false },
      ]),
    ).toEqual([]);
  });
});
