import { describe, expect, it } from 'vitest';

import { parseIssueNumber } from './issue_ref';

describe('parseIssueNumber', () => {
  it('extracts the number after the last #', () => {
    expect(parseIssueNumber('tale-project/tale#1851')).toBe(1851);
  });

  it('returns null for a missing external ref', () => {
    expect(parseIssueNumber(undefined)).toBeNull();
  });

  it('returns null when there is no numeric tail', () => {
    expect(parseIssueNumber('tale-project/tale')).toBeNull();
    expect(parseIssueNumber('owner/repo#abc')).toBeNull();
  });

  it('handles a ref whose owner/repo itself contains no hash', () => {
    expect(parseIssueNumber('a/b#42')).toBe(42);
  });
});
