import { describe, expect, it } from 'vitest';

import { parseIssueNumber, parseRepoRef } from './issue_ref';

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

describe('parseRepoRef', () => {
  it('extracts owner/repo from an "owner/repo#N" ref', () => {
    expect(parseRepoRef('tale-project/tale#1851')).toEqual({
      owner: 'tale-project',
      repo: 'tale',
    });
  });

  it('handles a ref with no issue number', () => {
    expect(parseRepoRef('owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('returns null for a missing ref', () => {
    expect(parseRepoRef(undefined)).toBeNull();
  });

  it('returns null when there is no owner/repo split', () => {
    expect(parseRepoRef('tale#1')).toBeNull();
    expect(parseRepoRef('/repo#1')).toBeNull();
    expect(parseRepoRef('owner/#1')).toBeNull();
  });

  it('returns null when the repo segment itself contains a slash', () => {
    expect(parseRepoRef('owner/repo/extra#1')).toBeNull();
  });
});
