import { describe, expect, it } from 'vitest';

import { type DerivableConfigField, deriveConfigValues } from './derive_config';

// The issue-desk rule: accept `owner/repo` or a full GitHub URL, split → owner+repo.
const GITHUB_REPO: DerivableConfigField = {
  key: 'repository',
  type: 'string',
  derive: {
    pattern:
      '^(?:https?://github\\.com/)?([^/\\s]+)/([^/\\s#]+?)(?:\\.git)?/?$',
    into: ['owner', 'repo'],
  },
};

describe('deriveConfigValues', () => {
  it('splits a plain owner/repo slug', () => {
    const { values, invalid } = deriveConfigValues([GITHUB_REPO], {
      repository: 'tale-project/tale',
    });
    expect(invalid).toEqual([]);
    expect(values).toEqual({
      repository: 'tale-project/tale',
      owner: 'tale-project',
      repo: 'tale',
    });
  });

  it('splits a full https GitHub URL', () => {
    const { values } = deriveConfigValues([GITHUB_REPO], {
      repository: 'https://github.com/tale-project/tale',
    });
    expect(values.owner).toBe('tale-project');
    expect(values.repo).toBe('tale');
  });

  it('strips a trailing .git and slash', () => {
    const { values } = deriveConfigValues([GITHUB_REPO], {
      repository: 'https://github.com/acme/widgets.git/',
    });
    expect(values.owner).toBe('acme');
    expect(values.repo).toBe('widgets');
  });

  it('trims surrounding whitespace before matching', () => {
    const { values, invalid } = deriveConfigValues([GITHUB_REPO], {
      repository: '  acme/widgets  ',
    });
    expect(invalid).toEqual([]);
    expect(values.owner).toBe('acme');
    expect(values.repo).toBe('widgets');
    // raw is kept untrimmed-as-entered only after coerce trims? raw keeps input.
    expect(values.repository).toBe('  acme/widgets  ');
  });

  it('flags a non-matching value as invalid and writes no sub-keys', () => {
    const { values, invalid } = deriveConfigValues([GITHUB_REPO], {
      repository: 'not a repo',
    });
    expect(invalid).toEqual(['repository']);
    expect(values.repository).toBe('not a repo');
    expect(values.owner).toBeUndefined();
    expect(values.repo).toBeUndefined();
  });

  it('treats a cleared value as unconfigured (raw only, no sub-keys, not invalid)', () => {
    const { values, invalid } = deriveConfigValues([GITHUB_REPO], {
      repository: '',
    });
    expect(invalid).toEqual([]);
    expect(values).toEqual({ repository: '' });
  });

  it('rejects an over-long input instead of running the regex on it', () => {
    const { invalid } = deriveConfigValues([GITHUB_REPO], {
      repository: 'a'.repeat(400) + '/b',
    });
    expect(invalid).toEqual(['repository']);
  });

  it('treats an un-compilable pattern as a non-match (never throws)', () => {
    const bad: DerivableConfigField = {
      key: 'x',
      type: 'string',
      derive: { pattern: '([', into: ['y'] },
    };
    const { invalid, values } = deriveConfigValues([bad], { x: 'anything' });
    expect(invalid).toEqual(['x']);
    expect(values.y).toBeUndefined();
  });

  it('passes plain (non-derive) fields through, coercing by type', () => {
    const fields: DerivableConfigField[] = [
      { key: 'name', type: 'string' },
      { key: 'count', type: 'number' },
      { key: 'on', type: 'boolean' },
    ];
    const { values, invalid } = deriveConfigValues(fields, {
      name: 'hi',
      count: '7' as unknown as string,
      on: true,
    });
    expect(invalid).toEqual([]);
    expect(values).toEqual({ name: 'hi', count: 7, on: true });
  });
});
