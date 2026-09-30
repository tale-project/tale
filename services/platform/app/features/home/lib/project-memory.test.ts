// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearProjectMemory,
  persistProjectMemory,
  readProjectMemory,
} from './project-memory';

beforeEach(() => {
  window.localStorage.clear();
});

describe('home project memory', () => {
  it('has nothing to read before anything is persisted', () => {
    expect(readProjectMemory('org-1')).toBeUndefined();
  });

  it('round-trips a persisted path', () => {
    persistProjectMemory(
      'org-1',
      '/dashboard/org-1/projects/proj-1/tasks/board',
    );
    expect(readProjectMemory('org-1')).toBe(
      '/dashboard/org-1/projects/proj-1/tasks/board',
    );
  });

  it('scopes the memory per organization', () => {
    persistProjectMemory('org-1', '/dashboard/org-1/projects/proj-1/files');
    expect(readProjectMemory('org-2')).toBeUndefined();
  });

  it('drops the memory on clear', () => {
    persistProjectMemory('org-1', '/dashboard/org-1/projects/proj-1/files');
    clearProjectMemory('org-1');
    expect(readProjectMemory('org-1')).toBeUndefined();
  });

  it('ignores corrupted storage rather than throwing', () => {
    window.localStorage.setItem(
      'tale.platform.home.org-1.lastProjectPath',
      '{not json',
    );
    expect(readProjectMemory('org-1')).toBeUndefined();
  });

  // Regression: a past write-side bug could persist a pathname belonging to
  // a DIFFERENT section (e.g. Automations' list) under this key. The read
  // side must reject it rather than trust whatever is stored, and clean up
  // so a later read doesn't keep re-validating the same bad value.
  it('rejects and clears a stored path that does not belong to this organization’s projects', () => {
    window.localStorage.setItem(
      'tale.platform.home.org-1.lastProjectPath',
      JSON.stringify('/dashboard/org-1/automations'),
    );
    expect(readProjectMemory('org-1')).toBeUndefined();
    expect(
      window.localStorage.getItem('tale.platform.home.org-1.lastProjectPath'),
    ).toBeNull();
  });
});
