// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNavMemory,
  clearNavSection,
  installNavMemory,
  parseDashboardPath,
  readNavTarget,
  recordNavLocation,
  sectionForPath,
  stripOneShotParams,
} from './nav-memory';

const ORG = 'org-1';
const KEY = `tale:nav-memory:v1:${ORG}`;
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sectionForPath', () => {
  it('maps all five knowledge tabs onto one section', () => {
    for (const segment of [
      'documents',
      'knowledge-entries',
      'websites',
      'products',
      'contacts',
    ]) {
      expect(sectionForPath(segment)).toBe('knowledge');
    }
  });

  it('reads the section from the first segment only', () => {
    expect(sectionForPath('projects/p1/tasks/board')).toBe('projects');
    expect(sectionForPath('conversations/open')).toBe('conversations');
  });

  it('returns undefined outside a section', () => {
    expect(sectionForPath('')).toBeUndefined();
    expect(sectionForPath('nonsense')).toBeUndefined();
  });
});

describe('parseDashboardPath', () => {
  it('splits the org id from the dashboard-relative path', () => {
    expect(
      parseDashboardPath('/dashboard/org-1/projects/p1/tasks/board'),
    ).toEqual({ organizationId: 'org-1', path: 'projects/p1/tasks/board' });
  });

  it('ignores the org home, which has no place to remember', () => {
    expect(parseDashboardPath('/dashboard/org-1')).toBeUndefined();
    expect(parseDashboardPath('/dashboard/org-1/')).toBeUndefined();
  });

  it('ignores the org-switch staging route', () => {
    expect(parseDashboardPath('/dashboard/switching')).toBeUndefined();
  });

  it('ignores non-dashboard routes', () => {
    expect(parseDashboardPath('/log-in')).toBeUndefined();
  });
});

describe('stripOneShotParams', () => {
  it('keeps a search that has no one-shot param', () => {
    expect(stripOneShotParams({ folderId: 'f1', doc: 'd1' })).toEqual({
      folderId: 'f1',
      doc: 'd1',
    });
  });

  it('drops the one-shot param and keeps the rest', () => {
    expect(
      stripOneShotParams({ folderId: 'f1', cloudImport: 'google' }),
    ).toEqual({ folderId: 'f1' });
  });

  it('returns undefined when only one-shot params were present', () => {
    expect(stripOneShotParams({ new: true })).toBeUndefined();
    expect(stripOneShotParams({})).toBeUndefined();
    expect(stripOneShotParams(undefined)).toBeUndefined();
  });
});

describe('readNavTarget / recordNavLocation', () => {
  it('round-trips a deep place with its search object', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board', { task: 'AG-31' });

    expect(readNavTarget(ORG, 'projects')).toEqual({
      path: 'projects/p1/tasks/board',
      search: { task: 'AG-31' },
    });
  });

  it('omits search entirely when there is none', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board', {});

    expect(readNavTarget(ORG, 'projects')).toEqual({
      path: 'projects/p1/tasks/board',
    });
  });

  it('preserves a non-string search value (the parser is JSON-based)', () => {
    recordNavLocation(ORG, 'settings/metrics/usage', { period: 90 });

    expect(readNavTarget(ORG, 'settings')?.search).toEqual({ period: 90 });
  });

  it('keeps sections independent', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    recordNavLocation(ORG, 'websites', { status: 'error' });

    expect(readNavTarget(ORG, 'projects')?.path).toBe(
      'projects/p1/tasks/board',
    );
    expect(readNavTarget(ORG, 'knowledge')?.path).toBe('websites');
  });

  it('never reads one org through another org id', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board');

    expect(readNavTarget('org-2', 'projects')).toBeUndefined();
  });

  it('prefers this tab over the shared copy', () => {
    recordNavLocation(ORG, 'projects/this-tab/tasks/board');
    // Stand in for another tab having recorded a different place.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        sections: { projects: { path: 'projects/other-tab/tasks/board' } },
        savedAt: Date.now(),
      }),
    );

    expect(readNavTarget(ORG, 'projects')?.path).toBe(
      'projects/this-tab/tasks/board',
    );
  });

  it('restores from the shared copy just inside the 8h window', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T09:00:00Z').getTime();
    vi.setSystemTime(start);
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    window.sessionStorage.clear();

    vi.setSystemTime(start + EIGHT_HOURS);

    expect(readNavTarget(ORG, 'projects')?.path).toBe(
      'projects/p1/tasks/board',
    );
  });

  it('forgets the shared copy once past the 8h window', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T09:00:00Z').getTime();
    vi.setSystemTime(start);
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    window.sessionStorage.clear();

    vi.setSystemTime(start + EIGHT_HOURS + 1);

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('slides the window: a later navigation refreshes the expiry', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T09:00:00Z').getTime();
    vi.setSystemTime(start);
    recordNavLocation(ORG, 'projects/p1/tasks/board');

    // Seven hours on, the user navigates again, then goes away for another
    // seven — 14h after the FIRST visit, but only 7h after the last.
    vi.setSystemTime(start + 7 * 60 * 60 * 1000);
    recordNavLocation(ORG, 'projects/p2/tasks/board');
    window.sessionStorage.clear();
    vi.setSystemTime(start + 14 * 60 * 60 * 1000);

    expect(readNavTarget(ORG, 'projects')?.path).toBe(
      'projects/p2/tasks/board',
    );
  });

  it('does not record a public shared-chat snapshot', () => {
    recordNavLocation(ORG, 'chat/t1');
    recordNavLocation(ORG, 'chat/shared/token-abc');

    expect(readNavTarget(ORG, 'chat')?.path).toBe('chat/t1');
  });

  it('does not record a path outside every section', () => {
    recordNavLocation(ORG, 'nonsense/deep');

    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('strips a one-shot param before storing', () => {
    recordNavLocation(ORG, 'documents', {
      folderId: 'f1',
      cloudImport: 'google',
    });

    expect(readNavTarget(ORG, 'knowledge')?.search).toEqual({ folderId: 'f1' });
  });

  it('ignores a malformed record instead of throwing', () => {
    window.sessionStorage.setItem(KEY, '{not json');

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
  });

  it('ignores a record whose stored target is not a shaped object', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        sections: { projects: 'projects/p1' },
        savedAt: Date.now(),
      }),
    );

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
  });

  it('drops one malformed section without losing the others', () => {
    // Destructuring a null value would throw and abandon the whole record,
    // taking every OTHER section's memory with it.
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        sections: { projects: null, chat: { path: 'chat/t1' } },
        savedAt: Date.now(),
      }),
    );

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
    expect(readNavTarget(ORG, 'chat')?.path).toBe('chat/t1');
  });

  it('ignores a record whose path is not a string', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        sections: { projects: { path: 42 } },
        savedAt: Date.now(),
      }),
    );

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
  });
});

describe('clearing', () => {
  it('clearNavSection forgets one section and keeps the others', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    recordNavLocation(ORG, 'automations/a1');

    clearNavSection(ORG, 'projects');

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
    expect(readNavTarget(ORG, 'automations')?.path).toBe('automations/a1');
  });

  it('clearNavMemory without an org clears every org', () => {
    recordNavLocation('org-1', 'projects/p1/tasks/board');
    recordNavLocation('org-2', 'projects/p2/tasks/board');

    clearNavMemory();

    expect(readNavTarget('org-1', 'projects')).toBeUndefined();
    expect(readNavTarget('org-2', 'projects')).toBeUndefined();
  });

  it('clearNavMemory with an org leaves the other orgs alone', () => {
    recordNavLocation('org-1', 'projects/p1/tasks/board');
    recordNavLocation('org-2', 'projects/p2/tasks/board');

    clearNavMemory('org-1');

    expect(readNavTarget('org-1', 'projects')).toBeUndefined();
    expect(readNavTarget('org-2', 'projects')?.path).toBe(
      'projects/p2/tasks/board',
    );
  });
});

describe('installNavMemory', () => {
  it('records the location the router resolved to', () => {
    let listener:
      | ((e: {
          toLocation: { pathname: string; search: Record<string, unknown> };
        }) => void)
      | undefined;
    const router = {
      subscribe: (_event: 'onResolved', fn: NonNullable<typeof listener>) => {
        listener = fn;
        return () => {};
      },
    };

    installNavMemory(router);
    listener?.({
      toLocation: {
        pathname: '/dashboard/org-1/projects/p1/tasks/board',
        search: { task: 'AG-31' },
      },
    });

    expect(readNavTarget('org-1', 'projects')).toEqual({
      path: 'projects/p1/tasks/board',
      search: { task: 'AG-31' },
    });
  });
});
