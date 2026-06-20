import { describe, expect, it } from 'vitest';

import {
  buildFolderView,
  isInFolder,
  normalizeFolderPath,
} from './folder-tree';

interface Item {
  id: string;
  folder: string;
}

const items: Item[] = [
  { id: 'root-a', folder: '' },
  { id: 'gh-issues-sync', folder: 'github/issues' },
  { id: 'gh-issues-triage', folder: 'github/issues' },
  { id: 'gh-pr-review', folder: 'github/pulls' },
  { id: 'gh-top', folder: 'github' },
  { id: 'slack-notify', folder: 'slack' },
];

const folderOf = (i: Item) => i.folder;

describe('normalizeFolderPath', () => {
  it('trims and collapses blank segments', () => {
    expect(normalizeFolderPath('/github//issues/')).toBe('github/issues');
    expect(normalizeFolderPath('  ')).toBe('');
  });
});

describe('buildFolderView at root', () => {
  const view = buildFolderView(items, folderOf, '');

  it('lists immediate child folders with nested counts', () => {
    expect(view.subfolders.map((f) => [f.path, f.count])).toEqual([
      ['github', 4], // 2 issues + 1 pulls + 1 direct
      ['slack', 1],
    ]);
  });

  it('lists only items with no folder', () => {
    expect(view.items.map((i) => i.id)).toEqual(['root-a']);
  });

  it('has no breadcrumb segments', () => {
    expect(view.segments).toEqual([]);
  });
});

describe('buildFolderView inside a folder', () => {
  it('shows subfolders and direct items of github', () => {
    const view = buildFolderView(items, folderOf, 'github');
    expect(view.subfolders.map((f) => [f.path, f.count])).toEqual([
      ['github/issues', 2],
      ['github/pulls', 1],
    ]);
    expect(view.items.map((i) => i.id)).toEqual(['gh-top']);
    expect(view.segments).toEqual(['github']);
  });

  it('shows leaf items of a deep folder with no further subfolders', () => {
    const view = buildFolderView(items, folderOf, 'github/issues');
    expect(view.subfolders).toEqual([]);
    expect(view.items.map((i) => i.id)).toEqual([
      'gh-issues-sync',
      'gh-issues-triage',
    ]);
    expect(view.segments).toEqual(['github', 'issues']);
  });
});

describe('isInFolder', () => {
  it('matches the folder and any descendant', () => {
    expect(isInFolder('github/issues', 'github')).toBe(true);
    expect(isInFolder('github', 'github')).toBe(true);
    expect(isInFolder('slack', 'github')).toBe(false);
    expect(isInFolder('anything', '')).toBe(true);
  });
});
