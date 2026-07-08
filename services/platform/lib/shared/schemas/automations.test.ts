import { describe, expect, it } from 'vitest';

import {
  automationDisplayFolder,
  automationManifestSchema,
  automationScope,
  isValidAutomationSlug,
} from './automations';

describe('automationManifestSchema — scope', () => {
  it('parses an explicit project scope', () => {
    const m = automationManifestSchema.parse({
      name: 'Desk',
      scope: 'project',
    });
    expect(m.scope).toBe('project');
  });

  it('accepts a manifest with no scope (back-compat)', () => {
    const m = automationManifestSchema.parse({ name: 'Desk' });
    expect(m.scope).toBeUndefined();
  });

  it('rejects an unknown scope value', () => {
    expect(() =>
      automationManifestSchema.parse({ name: 'Desk', scope: 'team' }),
    ).toThrow();
  });
});

describe('automationManifestSchema — labels', () => {
  it('parses catalog labels and keeps them optional', () => {
    const m = automationManifestSchema.parse({
      name: 'Desk',
      labels: ['GitHub', 'GitHub Issues'],
    });
    expect(m.labels).toEqual(['GitHub', 'GitHub Issues']);
    expect(
      automationManifestSchema.parse({ name: 'Desk' }).labels,
    ).toBeUndefined();
  });

  it('rejects more than six labels and non-string entries', () => {
    expect(
      automationManifestSchema.safeParse({
        name: 'Desk',
        labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }).success,
    ).toBe(false);
    expect(
      automationManifestSchema.safeParse({ name: 'Desk', labels: [42] })
        .success,
    ).toBe(false);
  });
});

describe('automationManifestSchema — folder (display grouping)', () => {
  it('accepts nested kebab/underscore paths and keeps the field optional', () => {
    expect(
      automationManifestSchema.parse({ name: 'Desk', folder: 'github/issues' })
        .folder,
    ).toBe('github/issues');
    expect(
      automationManifestSchema.parse({ name: 'Desk', folder: 'ops' }).folder,
    ).toBe('ops');
    expect(
      automationManifestSchema.parse({ name: 'Desk', folder: 'a_b/c-d' })
        .folder,
    ).toBe('a_b/c-d');
    expect(
      automationManifestSchema.parse({ name: 'Desk' }).folder,
    ).toBeUndefined();
  });

  it('rejects uppercase, empty segments, edge slashes, double underscores, and >64 chars', () => {
    const reject = (folder: string) =>
      expect(
        automationManifestSchema.safeParse({ name: 'Desk', folder }).success,
      ).toBe(false);
    reject('GitHub');
    reject('a//b');
    reject('/a');
    reject('a/');
    reject('a__b');
    reject(`${'a'.repeat(63)}/b`); // 65 chars
  });
});

describe('automationManifestSchema — skills (display declaration)', () => {
  it('parses declared skill slugs and keeps them optional', () => {
    expect(
      automationManifestSchema.parse({
        name: 'Desk',
        skills: ['triage-issues'],
      }).skills,
    ).toEqual(['triage-issues']);
    expect(
      automationManifestSchema.parse({ name: 'Desk' }).skills,
    ).toBeUndefined();
  });

  it('rejects non-string entries', () => {
    expect(
      automationManifestSchema.safeParse({ name: 'Desk', skills: [42] })
        .success,
    ).toBe(false);
  });
});

describe('automationDisplayFolder — fallback resolution', () => {
  it('falls back to the app slug when the manifest declares no folder', () => {
    expect(automationDisplayFolder({}, 'issue-desk')).toBe('issue-desk');
    expect(automationDisplayFolder(null, 'issue-desk')).toBe('issue-desk');
    expect(automationDisplayFolder(undefined, 'issue-desk')).toBe('issue-desk');
  });

  it('returns the declared folder when present', () => {
    expect(
      automationDisplayFolder({ folder: 'github/issues' }, 'issue-desk'),
    ).toBe('github/issues');
  });
});

describe('automationScope — default resolution', () => {
  it('defaults an absent scope to org', () => {
    expect(automationScope({})).toBe('org');
    expect(automationScope(null)).toBe('org');
    expect(automationScope(undefined)).toBe('org');
  });

  it('returns the declared scope when present', () => {
    expect(automationScope({ scope: 'project' })).toBe('project');
    expect(automationScope({ scope: 'org' })).toBe('org');
  });
});

describe('isValidAutomationSlug', () => {
  it('accepts kebab segments', () => {
    expect(isValidAutomationSlug('issue-desk')).toBe(true);
  });

  it('rejects underscores and uppercase', () => {
    expect(isValidAutomationSlug('issue_desk')).toBe(false);
    expect(isValidAutomationSlug('IssueDesk')).toBe(false);
  });
});

describe('automationManifestSchema — i18n (self-translation)', () => {
  it('parses per-locale name/description/config overrides and keeps the block optional', () => {
    const m = automationManifestSchema.parse({
      name: 'Desk',
      i18n: {
        de: {
          name: 'Schreibtisch',
          description: 'DE Beschreibung',
          config: { repo: { label: 'Repository' } },
        },
        fr: { name: 'Bureau' },
      },
    });
    expect(m.i18n?.de?.name).toBe('Schreibtisch');
    expect(m.i18n?.de?.config?.repo?.label).toBe('Repository');
    expect(m.i18n?.fr?.name).toBe('Bureau');
    expect(
      automationManifestSchema.parse({ name: 'Desk' }).i18n,
    ).toBeUndefined();
  });

  it('rejects a malformed locale tag', () => {
    expect(
      automationManifestSchema.safeParse({
        name: 'Desk',
        i18n: { DE: { name: 'x' } },
      }).success,
    ).toBe(false);
  });
});
