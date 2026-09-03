import { describe, expect, it } from 'vitest';

import {
  collectWorkflowFolderFiles,
  type WorkflowFolderLoaders,
} from './document-listing.ts';

/**
 * The walk behind `document.list`, over an in-memory tree. Regression: the
 * pg store answered `truncated: false` unconditionally over a 200-row cap
 * and ignored `folderPath`/`recursive` — an automation iterating a big
 * folder skipped the older files while being told the listing was whole.
 */

interface Tree {
  files: Record<string, string[]>;
  subfolders: Record<string, string[]>;
}

function loadersFor(tree: Tree): WorkflowFolderLoaders & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    filesIn: (folderId, limit) => {
      reads.push(`${folderId ?? 'root'}:${limit}`);
      const all = tree.files[folderId ?? 'root'] ?? [];
      return Promise.resolve({
        files: all.slice(0, limit).map((name) => ({ name, storageId: name })),
        truncated: all.length > limit,
      });
    },
    subfoldersOf: (folderId) =>
      Promise.resolve(
        (tree.subfolders[folderId ?? 'root'] ?? []).map((name) => ({
          id: name,
          name,
        })),
      ),
  };
}

const names = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

describe('collectWorkflowFolderFiles', () => {
  it('lists a folder whole and says so', async () => {
    const loaders = loadersFor({
      files: { A: names('a', 3) },
      subfolders: {},
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: false,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files.map((f) => f.name)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(out.truncated).toBe(false);
  });

  it('reports truncated when the folder holds more than the cap', async () => {
    const loaders = loadersFor({
      files: { A: names('a', 201) },
      subfolders: {},
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: false,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files).toHaveLength(200);
    expect(out.truncated).toBe(true);
    // The loader is asked for exactly the room left, never the whole folder.
    expect(loaders.reads).toEqual(['A:200']);
  });

  it('a folder holding exactly the cap is not truncated', async () => {
    const loaders = loadersFor({
      files: { A: names('a', 200) },
      subfolders: {},
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: false,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files).toHaveLength(200);
    expect(out.truncated).toBe(false);
  });

  it('walks subfolders when recursive and prefixes names with their path', async () => {
    const loaders = loadersFor({
      files: { A: ['top.pdf'], B: ['mid.pdf'], C: ['deep.pdf'] },
      subfolders: { A: ['B'], B: ['C'] },
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: true,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files.map((f) => f.name)).toEqual([
      'top.pdf',
      'B/mid.pdf',
      'B/C/deep.pdf',
    ]);
    expect(out.truncated).toBe(false);
  });

  it('ignores subfolders when not recursive', async () => {
    const loaders = loadersFor({
      files: { A: ['top.pdf'], B: ['mid.pdf'] },
      subfolders: { A: ['B'] },
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: false,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files.map((f) => f.name)).toEqual(['top.pdf']);
    expect(loaders.reads).toEqual(['A:200']);
  });

  it('stops at the cap across subfolders and says the tree was cut', async () => {
    const loaders = loadersFor({
      files: { A: names('a', 150), B: names('b', 100), C: ['never-read'] },
      subfolders: { A: ['B', 'C'] },
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: true,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files).toHaveLength(200);
    expect(out.files.at(-1)?.name).toBe('B/b-50');
    expect(out.truncated).toBe(true);
    // C was queued but never read once the cap was reached.
    expect(loaders.reads).toEqual(['A:200', 'B:50']);
  });

  it('bounds the depth and flags the unread remainder', async () => {
    const loaders = loadersFor({
      files: { A: [], B: ['b.pdf'], C: ['c.pdf'] },
      subfolders: { A: ['B'], B: ['C'] },
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: 'A',
      recursive: true,
      cap: 200,
      maxDepth: 1,
    });
    expect(out.files.map((f) => f.name)).toEqual(['B/b.pdf']);
    expect(out.truncated).toBe(true);
  });

  it('lists the hub root when the folder id is null', async () => {
    const loaders = loadersFor({
      files: { root: ['loose.pdf'], A: ['a.pdf'] },
      subfolders: { root: ['A'] },
    });
    const out = await collectWorkflowFolderFiles(loaders, {
      rootFolderId: null,
      recursive: true,
      cap: 200,
      maxDepth: 20,
    });
    expect(out.files.map((f) => f.name)).toEqual(['loose.pdf', 'A/a.pdf']);
  });
});
