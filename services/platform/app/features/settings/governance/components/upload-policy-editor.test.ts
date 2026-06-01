import { describe, it, expect } from 'vitest';

import { findConflictingExtensions } from './upload-policy-editor';

// Regression test for #1479: the upload policy must not accept the same
// extension in both the allowed and blocked lists.
describe('findConflictingExtensions (#1479)', () => {
  it('returns extensions present in both lists', () => {
    expect(findConflictingExtensions('pdf, docx', 'pdf, exe')).toEqual(['pdf']);
  });

  it('matches case-insensitively and ignores a leading dot (echoes the blocked-list spelling)', () => {
    expect(findConflictingExtensions('PDF, .docx', 'pdf, .DOCX')).toEqual([
      'pdf',
      'DOCX',
    ]);
  });

  it('returns an empty array when the lists are disjoint', () => {
    expect(findConflictingExtensions('pdf, docx', 'exe, bat')).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(findConflictingExtensions('', '')).toEqual([]);
    expect(findConflictingExtensions('pdf', '')).toEqual([]);
    expect(findConflictingExtensions('', 'pdf')).toEqual([]);
  });

  it('supports space- and comma-separated values', () => {
    expect(findConflictingExtensions('pdf docx xlsx', 'xlsx,zip')).toEqual([
      'xlsx',
    ]);
  });
});
