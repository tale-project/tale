import { describe, expect, it } from 'vitest';

import { validateFolderName } from '../../../backend/domains/folders/paths.ts';
import { folderNameSchema } from './folder-name.ts';

const schema = folderNameSchema('Name required', 'Invalid folder name');

describe('folderNameSchema', () => {
  it.each([
    'Reports/2026',
    'Reports\\2026',
    'Reports\u00002026',
    'Reports\t2026',
    'Reports\u007f2026',
    '.',
    ' .. ',
    'x'.repeat(129),
  ])('shares the server refusal for %j', (name) => {
    const result = schema.safeParse(name);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Invalid folder name');
    }
    expect(() => validateFolderName(name)).toThrow();
  });

  it('names a blank name as required', () => {
    const result = schema.safeParse('  ');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Name required');
    }
  });

  it.each([
    'Reports 2026',
    'x'.repeat(128),
    '  Reports 2026  ',
    'e\u0301'.repeat(128),
    '...',
  ])('shares the server canonical name for %j', (name) => {
    expect(schema.parse(name)).toBe(validateFolderName(name));
  });
});
