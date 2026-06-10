import { describe, expect, it } from 'vitest';

import { MAX_FOLDER_PATH_LENGTH, normalizeFolderPath } from './rag_folder_path';

describe('normalizeFolderPath', () => {
  it('returns a plain path unchanged', () => {
    expect(normalizeFolderPath('contracts/2024')).toBe('contracts/2024');
  });

  it('strips surrounding whitespace and slashes', () => {
    expect(normalizeFolderPath(' /contracts/2024/ ')).toBe('contracts/2024');
    expect(normalizeFolderPath('/ / a')).toBe('a');
  });

  it('preserves inner slashes', () => {
    expect(normalizeFolderPath('a/b/c')).toBe('a/b/c');
  });

  it('returns undefined for empty and separator-only values', () => {
    expect(normalizeFolderPath('')).toBeUndefined();
    expect(normalizeFolderPath('   ')).toBeUndefined();
    expect(normalizeFolderPath('///')).toBeUndefined();
  });

  it('returns undefined for null and undefined', () => {
    expect(normalizeFolderPath(null)).toBeUndefined();
    expect(normalizeFolderPath(undefined)).toBeUndefined();
  });

  it('returns undefined for over-long paths', () => {
    expect(
      normalizeFolderPath('x'.repeat(MAX_FOLDER_PATH_LENGTH + 1)),
    ).toBeUndefined();
  });
});
