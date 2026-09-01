import { describe, expect, it } from 'vitest';

import {
  buildSyncImportItems,
  selectDocumentsToPrune,
} from './reconcile_folder_sync';

const config = {
  configId: 'cfg-1',
  itemId: 'folder-meetings',
  itemName: 'Meetings',
  itemPath: 'Meetings',
};

describe('buildSyncImportItems', () => {
  it('roots paths at the config itemPath and links files to the folder', () => {
    const items = buildSyncImportItems(config, [
      { id: 'f1', name: 'a.txt', size: 1, relativePath: 'a.txt' },
      { id: 'f2', name: 'b.txt', size: 2, relativePath: 'Sub/b.txt' },
    ]);

    expect(items).toEqual([
      {
        id: 'f1',
        name: 'a.txt',
        size: 1,
        relativePath: 'Meetings/a.txt',
        isDirectlySelected: false,
        selectedParentId: 'folder-meetings',
        selectedParentName: 'Meetings',
        selectedParentPath: 'Meetings',
      },
      {
        id: 'f2',
        name: 'b.txt',
        size: 2,
        relativePath: 'Meetings/Sub/b.txt',
        isDirectlySelected: false,
        selectedParentId: 'folder-meetings',
        selectedParentName: 'Meetings',
        selectedParentPath: 'Meetings',
      },
    ]);
  });

  it('falls back to the file name when the listing carries no relativePath', () => {
    const items = buildSyncImportItems(config, [
      { id: 'f1', name: 'a.txt', size: 1 },
    ]);

    expect(items[0].relativePath).toBe('Meetings/a.txt');
  });
});

describe('selectDocumentsToPrune', () => {
  const currentIds = new Set(['f1']);

  it('prunes an auto document whose source file disappeared', () => {
    expect(
      selectDocumentsToPrune('cfg-1', currentIds, [
        {
          documentId: 'doc-gone',
          externalItemId: 'f-removed',
          syncConfigId: 'cfg-1',
          sourceMode: 'auto',
        },
        {
          documentId: 'doc-kept',
          externalItemId: 'f1',
          syncConfigId: 'cfg-1',
          sourceMode: 'auto',
        },
      ]),
    ).toEqual(['doc-gone']);
  });

  it('never touches manual uploads or other configs', () => {
    expect(
      selectDocumentsToPrune('cfg-1', currentIds, [
        {
          documentId: 'doc-manual',
          externalItemId: 'f-removed',
          syncConfigId: 'cfg-1',
          sourceMode: 'manual',
        },
        {
          documentId: 'doc-other-config',
          externalItemId: 'f-removed',
          syncConfigId: 'cfg-2',
          sourceMode: 'auto',
        },
        {
          documentId: 'doc-no-config',
          externalItemId: 'f-removed',
          sourceMode: 'auto',
        },
        {
          documentId: 'doc-no-external-id',
          syncConfigId: 'cfg-1',
          sourceMode: 'auto',
        },
      ]),
    ).toEqual([]);
  });
});
