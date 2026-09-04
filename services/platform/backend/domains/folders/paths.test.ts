import { describe, expect, it } from 'vitest';

import { documentFolderPathFrom, normalizeFolderPath } from './paths.ts';

/**
 * The canonical folder-path spelling every path-comparing surface agrees on
 * — the knowledge folder filter, the corpus stamp it matches against, and the
 * agent-facing listing that hands the path back as a filter. Two spellings
 * reach the database (WebDAV's 0.4 `'/A/B'`, the tree's `'A/B'`); neither may
 * decide whether a document is found.
 */
describe('normalizeFolderPath', () => {
  it('strips leading and trailing slashes and collapses runs', () => {
    expect(normalizeFolderPath('/Reports/2025/')).toBe('Reports/2025');
    expect(normalizeFolderPath('Reports//2025')).toBe('Reports/2025');
    expect(normalizeFolderPath('Reports')).toBe('Reports');
  });

  it('trims segment whitespace', () => {
    expect(normalizeFolderPath(' Reports / 2025 ')).toBe('Reports/2025');
  });

  it('reads the root and nothing as null', () => {
    expect(normalizeFolderPath('/')).toBeNull();
    expect(normalizeFolderPath('')).toBeNull();
    expect(normalizeFolderPath('   ')).toBeNull();
    expect(normalizeFolderPath(null)).toBeNull();
    expect(normalizeFolderPath(undefined)).toBeNull();
  });
});

describe('documentFolderPathFrom', () => {
  const tree = new Map([['f1', 'Reports/2025']]);

  it('prefers the folder tree — it stays fresh across renames and moves', () => {
    expect(
      documentFolderPathFrom({ folderId: 'f1', folderPath: '/Old/Name' }, tree),
    ).toBe('Reports/2025');
  });

  it('falls back to the stamped source path for a document without a hub folder', () => {
    expect(
      documentFolderPathFrom(
        { folderId: null, folderPath: '/Shared/Docs' },
        tree,
      ),
    ).toBe('Shared/Docs');
    // A folder id the tree does not know (foreign, or gone) falls back too.
    expect(
      documentFolderPathFrom({ folderId: 'missing', folderPath: 'X' }, tree),
    ).toBe('X');
  });

  it('is null for a root document', () => {
    expect(
      documentFolderPathFrom({ folderId: null, folderPath: null }, tree),
    ).toBe(null);
  });
});
