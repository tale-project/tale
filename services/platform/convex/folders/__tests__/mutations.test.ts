import { describe, expect, it } from 'vitest';

import { validateFolderName } from '../mutations';

describe('validateFolderName', () => {
  it('trims whitespace and returns clean name', () => {
    expect(validateFolderName('  docs  ')).toBe('docs');
  });

  it('throws for empty name', () => {
    expect(() => validateFolderName('')).toThrow('Folder name cannot be empty');
  });

  it('throws for whitespace-only name', () => {
    expect(() => validateFolderName('   ')).toThrow(
      'Folder name cannot be empty',
    );
  });

  it('throws for reserved name "."', () => {
    expect(() => validateFolderName('.')).toThrow('Invalid folder name');
  });

  it('throws for reserved name ".."', () => {
    expect(() => validateFolderName('..')).toThrow('Invalid folder name');
  });

  it('throws for names exceeding max length', () => {
    const longName = 'a'.repeat(256);
    expect(() => validateFolderName(longName)).toThrow(
      'Folder name is too long',
    );
  });

  it('allows names at max length', () => {
    const maxName = 'a'.repeat(255);
    expect(validateFolderName(maxName)).toBe(maxName);
  });
});
