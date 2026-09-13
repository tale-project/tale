import { describe, expect, it } from 'vitest';

import {
  documentFolderPathFrom,
  FolderNameError,
  normalizeFolderPath,
  validateFolderName,
} from './paths.ts';

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

/**
 * The folder name rule: canonical (NFC, trimmed — the rule the REST file
 * name and every caller-owned key follow, so two normalizations of `café`
 * are one folder), bounded, not a path, and refused with the reason a
 * person can act on — "Invalid folder name" named none (2026-09-13
 * evaluation, E2-04 / E2-07).
 */
describe('validateFolderName', () => {
  it('answers the name trimmed and NFC-normalized', () => {
    expect(validateFolderName('  cafe\u0301  ')).toBe('caf\u00e9');
    expect(validateFolderName('2026-Q1 invoices')).toBe('2026-Q1 invoices');
  });

  it.each([
    ['blank', '   ', 'must not be blank'],
    ['too long', 'x'.repeat(129), 'must be at most 128 characters'],
    ['a slash', 'a/b', 'must not contain a path separator ("/" or "\\")'],
    ['a backslash', 'a\\b', 'must not contain a path separator ("/" or "\\")'],
    ['a tab', 'a\tb', 'must not contain a control character'],
    ['DEL', 'a\u007fb', 'must not contain a control character'],
    ['a dot', '.', 'must not be "." or ".."'],
    ['two dots', ' .. ', 'must not be "." or ".."'],
  ])('refuses %s, naming the rule', (_what, name, rule) => {
    let thrown: unknown;
    try {
      validateFolderName(name);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FolderNameError);
    if (!(thrown instanceof FolderNameError)) return;
    expect(thrown.rule).toBe(rule);
    expect(thrown.message).toBe(`Folder name ${rule}`);
  });

  it('judges the length after canonicalization', () => {
    // 128 decomposed pairs are 256 code units as sent and 128 once composed.
    expect(validateFolderName('e\u0301'.repeat(128))).toHaveLength(128);
  });
});
