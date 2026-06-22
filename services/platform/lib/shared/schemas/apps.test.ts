import { describe, expect, it } from 'vitest';

import { appManifestSchema, appScope, isValidAppSlug } from './apps';

describe('appManifestSchema — scope', () => {
  it('parses an explicit project scope', () => {
    const m = appManifestSchema.parse({ name: 'Desk', scope: 'project' });
    expect(m.scope).toBe('project');
  });

  it('accepts a manifest with no scope (back-compat)', () => {
    const m = appManifestSchema.parse({ name: 'Desk' });
    expect(m.scope).toBeUndefined();
  });

  it('rejects an unknown scope value', () => {
    expect(() =>
      appManifestSchema.parse({ name: 'Desk', scope: 'team' }),
    ).toThrow();
  });
});

describe('appScope — default resolution', () => {
  it('defaults an absent scope to org', () => {
    expect(appScope({})).toBe('org');
    expect(appScope(null)).toBe('org');
    expect(appScope(undefined)).toBe('org');
  });

  it('returns the declared scope when present', () => {
    expect(appScope({ scope: 'project' })).toBe('project');
    expect(appScope({ scope: 'org' })).toBe('org');
  });
});

describe('isValidAppSlug', () => {
  it('accepts kebab segments', () => {
    expect(isValidAppSlug('issue-desk')).toBe(true);
  });

  it('rejects underscores and uppercase', () => {
    expect(isValidAppSlug('issue_desk')).toBe(false);
    expect(isValidAppSlug('IssueDesk')).toBe(false);
  });
});
