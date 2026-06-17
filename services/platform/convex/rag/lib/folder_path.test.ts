import { describe, expect, it } from 'vitest';

import { MAX_FOLDER_PATH_LENGTH, normalizeFolderPath } from './folder_path';

describe('normalizeFolderPath', () => {
  it('keeps a canonical parent/child path unchanged', () => {
    expect(normalizeFolderPath('parent/child')).toBe('parent/child');
  });

  it('strips leading and trailing slashes', () => {
    expect(normalizeFolderPath('/parent/child/')).toBe('parent/child');
    expect(normalizeFolderPath('///a/b///')).toBe('a/b');
  });

  it('strips surrounding whitespace', () => {
    expect(normalizeFolderPath('  folder  ')).toBe('folder');
    expect(normalizeFolderPath('\t\nfolder\r\n')).toBe('folder');
  });

  it('strips mixed surrounding whitespace and slashes', () => {
    expect(normalizeFolderPath('  / folder / ')).toBe('folder');
  });

  it('preserves interior slashes and spaces', () => {
    expect(normalizeFolderPath('My Folder/Sub Folder')).toBe(
      'My Folder/Sub Folder',
    );
  });

  it('returns null for an empty string', () => {
    expect(normalizeFolderPath('')).toBeNull();
  });

  it('returns null for an all-separator string', () => {
    expect(normalizeFolderPath('///')).toBeNull();
    expect(normalizeFolderPath('  /  ')).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(normalizeFolderPath(null)).toBeNull();
    expect(normalizeFolderPath(undefined)).toBeNull();
    expect(normalizeFolderPath(42)).toBeNull();
    expect(normalizeFolderPath({})).toBeNull();
  });

  it('exposes the documented max length constant', () => {
    expect(MAX_FOLDER_PATH_LENGTH).toBe(1024);
  });
});
