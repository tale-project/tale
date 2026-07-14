import { describe, expect, it } from 'vitest';

import {
  automationManifestSchema,
  automationParentFolder,
  automationScope,
  automationSlugToParam,
  isValidAutomationSlug,
  paramToAutomationSlug,
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

describe('automationParentFolder — the folder is derived, never declared', () => {
  it('returns the parent path of a nested slug', () => {
    expect(automationParentFolder('gmail/sync-emails')).toBe('gmail');
    expect(automationParentFolder('projects/tasks/run-assigned')).toBe(
      'projects/tasks',
    );
  });

  it('returns the empty folder for a root-level slug (the "General" bucket)', () => {
    expect(automationParentFolder('my-automation')).toBe('');
  });

  it('groups an automation-owned agent under its automation', () => {
    // An agent's path is `<automationSlug>/<name>` — one rule, both lists.
    expect(
      automationParentFolder('github/create-pull-requests/pr-creator'),
    ).toBe('github/create-pull-requests');
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

describe('automationManifestSchema — folder is no longer a manifest field', () => {
  it('ignores a legacy `folder` key instead of failing an installed manifest', () => {
    // The slug carries the path now; a stale key in an org's on-disk manifest
    // must not break its parse (the schema passes unknown keys through).
    const m = automationManifestSchema.parse({
      name: 'Desk',
      folder: 'github/issues',
    });
    expect(m.name).toBe('Desk');
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

describe('isValidAutomationSlug — the slug is a PATH', () => {
  it('accepts a root-level kebab slug', () => {
    expect(isValidAutomationSlug('issue-desk')).toBe(true);
  });

  it('accepts nested paths up to the depth cap', () => {
    expect(isValidAutomationSlug('gmail/sync-emails')).toBe(true);
    expect(isValidAutomationSlug('projects/tasks/run-assigned')).toBe(true);
    expect(isValidAutomationSlug('a/b/c/d')).toBe(true);
  });

  it('rejects a path deeper than the cap (the walkers stop there)', () => {
    expect(isValidAutomationSlug('a/b/c/d/e')).toBe(false);
  });

  it('rejects underscores and uppercase', () => {
    // No underscore in the alphabet ⇒ `__` can never occur inside a slug, which
    // is what keeps it usable as the URL separator.
    expect(isValidAutomationSlug('issue_desk')).toBe(false);
    expect(isValidAutomationSlug('IssueDesk')).toBe(false);
    expect(isValidAutomationSlug('a__b')).toBe(false);
  });

  it('rejects empty segments, edge slashes, and traversal', () => {
    expect(isValidAutomationSlug('a//b')).toBe(false);
    expect(isValidAutomationSlug('/a')).toBe(false);
    expect(isValidAutomationSlug('a/')).toBe(false);
    expect(isValidAutomationSlug('../etc')).toBe(false);
    expect(isValidAutomationSlug('a/../b')).toBe(false);
  });

  it('rejects a slug over 128 chars', () => {
    expect(isValidAutomationSlug(`${'a'.repeat(64)}/${'b'.repeat(64)}`)).toBe(
      false,
    );
  });
});

describe('automationSlugToParam — one URL path segment, losslessly', () => {
  it('round-trips a nested slug through the `__` separator', () => {
    const slug = 'projects/tasks/run-assigned';
    const param = automationSlugToParam(slug);
    expect(param).toBe('projects__tasks__run-assigned');
    expect(paramToAutomationSlug(param)).toBe(slug);
  });

  it('leaves a root-level slug untouched', () => {
    expect(automationSlugToParam('issue-desk')).toBe('issue-desk');
    expect(paramToAutomationSlug('issue-desk')).toBe('issue-desk');
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
