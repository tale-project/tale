// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNavMemory,
  clearNavSection,
  installNavMemory,
  parseDashboardPath,
  readNavTarget,
  recordNavLocation,
  sectionForSubpath,
  stripOneShotParams,
} from './nav-memory';

const ORG = 'org-1';
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

describe('sectionForSubpath', () => {
  it('maps all five knowledge tabs onto one section', () => {
    for (const segment of [
      'documents',
      'knowledge-entries',
      'websites',
      'products',
      'contacts',
    ]) {
      expect(sectionForSubpath(segment)).toBe('knowledge');
    }
  });

  it('reads the section from the first segment only', () => {
    expect(sectionForSubpath('projects/p1/tasks/board?task=AG-31')).toBe(
      'projects',
    );
    expect(sectionForSubpath('conversations/open')).toBe('conversations');
  });

  it('returns undefined outside a section', () => {
    expect(sectionForSubpath('')).toBeUndefined();
    expect(sectionForSubpath('nonsense')).toBeUndefined();
  });
});

describe('parseDashboardPath', () => {
  it('splits the org id from the subpath and appends the search string', () => {
    expect(
      parseDashboardPath('/dashboard/org-1/projects/p1/tasks/board', '?task=A'),
    ).toEqual({
      organizationId: 'org-1',
      subpath: 'projects/p1/tasks/board?task=A',
    });
  });

  it('ignores the org home, which has no subpath to remember', () => {
    expect(parseDashboardPath('/dashboard/org-1')).toBeUndefined();
    expect(parseDashboardPath('/dashboard/org-1/')).toBeUndefined();
  });

  it('ignores the org-switch staging route', () => {
    expect(parseDashboardPath('/dashboard/switching', '?to=org-2')).toBe(
      undefined,
    );
  });

  it('ignores non-dashboard routes', () => {
    expect(parseDashboardPath('/log-in')).toBeUndefined();
  });
});

describe('stripOneShotParams', () => {
  it('leaves a subpath byte-identical when no one-shot param is present', () => {
    const subpath = 'documents?folderId=f1&doc=d1';
    expect(stripOneShotParams(subpath)).toBe(subpath);
  });

  it('drops the one-shot param and keeps the rest', () => {
    expect(stripOneShotParams('documents?folderId=f1&cloudImport=google')).toBe(
      'documents?folderId=f1',
    );
  });

  it('drops the query entirely when only one-shot params remain', () => {
    expect(stripOneShotParams('chat?new=1')).toBe('chat');
  });
});

describe('readNavTarget / recordNavLocation', () => {
  it('round-trips a deep subpath for its section', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board?task=AG-31');

    expect(readNavTarget(ORG, 'projects')).toBe(
      'projects/p1/tasks/board?task=AG-31',
    );
  });

  it('keeps sections independent', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    recordNavLocation(ORG, 'websites?status=error');

    expect(readNavTarget(ORG, 'projects')).toBe('projects/p1/tasks/board');
    expect(readNavTarget(ORG, 'knowledge')).toBe('websites?status=error');
  });

  it('never reads one org through another org id', () => {
    recordNavLocation(ORG, 'projects/p1/tasks/board');

    expect(readNavTarget('org-2', 'projects')).toBeUndefined();
  });

  it('prefers this tab over the shared copy', () => {
    // The shared copy stands for another tab having recorded a different place.
    recordNavLocation(ORG, 'projects/shared-tab/tasks/board');
    window.sessionStorage.clear();
    recordNavLocation(ORG, 'projects/this-tab/tasks/board');
    window.localStorage.setItem(
      'tale:nav-memory:v1:' + ORG,
      JSON.stringify({
        sections: { projects: 'projects/shared-tab/tasks/board' },
        savedAt: Date.now(),
      }),
    );

    expect(readNavTarget(ORG, 'projects')).toBe(
      'projects/this-tab/tasks/board',
    );
  });

  it('restores from the shared copy just inside the 8h window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'));
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    window.sessionStorage.clear();

    vi.setSystemTime(new Date('2026-01-01T09:00:00Z').getTime() + EIGHT_HOURS);

    expect(readNavTarget(ORG, 'projects')).toBe('projects/p1/tasks/board');
  });

  it('forgets the shared copy once past the 8h window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'));
    recordNavLocation(ORG, 'projects/p1/tasks/board');
    window.sessionStorage.clear();

    vi.setSystemTime(
      new Date('2026-01-01T09:00:00Z').getTime() + EIGHT_HOURS + 1,
    );

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
    expect(window.localStorage.getItem('tale:nav-memory:v1:' + ORG)).toBeNull();
  });

  it('slides the window: a later navigation refreshes the expiry', () => {
    vi.useFakeTimers();
    const start = new Date('2026-01-01T09:00:00Z').getTime();
    vi.setSystemTime(start);
    recordNavLocation(ORG, 'projects/p1/tasks/board');

    // Seven hours later the user navigates again, then goes away for another
    // seven — 14h after the FIRST visit, but only 7h after the last.
    vi.setSystemTime(start + 7 * 60 * 60 * 1000);
    recordNavLocation(ORG, 'projects/p2/tasks/board');
    window.sessionStorage.clear();
    vi.setSystemTime(start + 14 * 60 * 60 * 1000);

    expect(readNavTarget(ORG, 'projects')).toBe('projects/p2/tasks/board');
  });

  it('does not record a public shared-chat snapshot', () => {
    recordNavLocation(ORG, 'chat/t1');
    recordNavLocation(ORG, 'chat/shared/token-abc');

    expect(readNavTarget(ORG, 'chat')).toBe('chat/t1');
  });

  it('does not record a path outside every section', () => {
    recordNavLocation(ORG, 'nonsense/deep');

    expect(window.localStorage.getItem('tale:nav-memory:v1:' + ORG)).toBeNull();
  });

  it('strips a one-shot param before storing', () => {
    recordNavLocation(ORG, 'documents?folderId=f1&cloudImport=google');

    expect(readNavTarget(ORG, 'knowledge')).toBe('documents?folderId=f1');
  });

  it('ignores a malformed record instead of throwing', () => {
    window.sessionStorage.setItem('tale:nav-memory:v1:' + ORG, '{not json');

    expect(readNavTarget(ORG, 'projects')).toBeUndefined();
  });

  it('ignores a record whose section value is not a string', () => {
    window.sessionStorage.setItem(
      'tale:nav-memory:v1:' + ORG,
      JSON.stringify({ sections: { projects: 42 }, savedAt: Date.now() }),
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
    expect(readNavTarget(ORG, 'automations')).toBe('automations/a1');
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
    expect(readNavTarget('org-2', 'projects')).toBe('projects/p2/tasks/board');
  });
});

describe('installNavMemory', () => {
  it('records the location the router resolved to', () => {
    let listener:
      | ((e: { toLocation: { pathname: string; searchStr: string } }) => void)
      | undefined;
    const router = {
      subscribe: (_event: 'onResolved', fn: typeof listener) => {
        listener = fn;
        return () => {};
      },
    };

    installNavMemory(router);
    listener?.({
      toLocation: {
        pathname: '/dashboard/org-1/projects/p1/tasks/board',
        searchStr: '?task=AG-31',
      },
    });

    expect(readNavTarget('org-1', 'projects')).toBe(
      'projects/p1/tasks/board?task=AG-31',
    );
  });
});
