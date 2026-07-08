/**
 * Unit tests for the moved-slug redirect resolver behind the docs server's
 * 301s. Locks in the URL shapes the resolver must honour: the English
 * canonical path, the `de`/`fr` locale prefixes, the `.md` LLM-artifact
 * variant, and trailing slashes — plus the misses that must fall through to
 * the SPA (unmoved pages, the new slugs themselves, unknown locales).
 */

import { describe, expect, it } from 'vitest';

import { MOVED_SLUGS, resolveMovedPath } from './redirects';

describe('resolveMovedPath', () => {
  it('maps every moved slug at the English canonical path', () => {
    for (const [oldSlug, newSlug] of MOVED_SLUGS) {
      expect(resolveMovedPath(`/${oldSlug}`)).toBe(`/${newSlug}`);
    }
  });

  it('preserves the de and fr locale prefixes', () => {
    expect(resolveMovedPath('/de/platform/automations/triggers')).toBe(
      '/de/platform/workflows/triggers',
    );
    expect(resolveMovedPath('/fr/platform/automations/execution-logs')).toBe(
      '/fr/platform/workflows/execution-logs',
    );
    expect(resolveMovedPath('/de/platform/conversations/overview')).toBe(
      '/de/platform/automations/builtin',
    );
    expect(resolveMovedPath('/fr/platform/agents/catalog')).toBe(
      '/fr/platform/automations/concepts',
    );
  });

  it('does not redirect the reclaimed platform/automations/concepts slug', () => {
    // Apps -> Automations reused this exact slug for new, unrelated content
    // after the old Automations -> Workflows rename freed it up; it must
    // resolve as a live page, never bounce to Workflows.
    expect(resolveMovedPath('/platform/automations/concepts')).toBeNull();
  });

  it('preserves the .md artifact suffix', () => {
    expect(resolveMovedPath('/platform/automations/triggers.md')).toBe(
      '/platform/workflows/triggers.md',
    );
    expect(resolveMovedPath('/de/platform/automations/metrics.md')).toBe(
      '/de/platform/workflows/metrics.md',
    );
  });

  it('drops a trailing slash on the old URL', () => {
    expect(resolveMovedPath('/platform/automations/workflows/')).toBe(
      '/platform/workflows/workflows',
    );
  });

  it('returns null for paths that did not move', () => {
    expect(resolveMovedPath('/platform/agents/concepts')).toBeNull();
    expect(resolveMovedPath('/platform/automations')).toBeNull();
    expect(resolveMovedPath('/platform/automations/unknown-page')).toBeNull();
    expect(resolveMovedPath('/platform/automations/catalog')).toBeNull();
    expect(resolveMovedPath('/platform/automations/builtin')).toBeNull();
    expect(resolveMovedPath('/platform/automations/assistant')).toBeNull();
    expect(resolveMovedPath('/')).toBeNull();
  });

  it('returns null for the new slugs themselves (no redirect loop)', () => {
    for (const newSlug of MOVED_SLUGS.values()) {
      expect(resolveMovedPath(`/${newSlug}`)).toBeNull();
      expect(resolveMovedPath(`/de/${newSlug}`)).toBeNull();
    }
  });

  it('does not treat an unknown first segment as a locale', () => {
    expect(resolveMovedPath('/it/platform/automations/concepts')).toBeNull();
  });
});
