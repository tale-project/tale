// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAutomationMemory,
  persistAutomationMemory,
  readAutomationMemory,
} from './detail-memory';

beforeEach(() => {
  window.localStorage.clear();
});

describe('automation detail memory', () => {
  it('has nothing to read before anything is persisted', () => {
    expect(readAutomationMemory('org-1')).toBeUndefined();
  });

  it('round-trips a persisted path', () => {
    persistAutomationMemory(
      'org-1',
      '/dashboard/org-1/automations/billing__dunning/runs',
    );
    expect(readAutomationMemory('org-1')).toBe(
      '/dashboard/org-1/automations/billing__dunning/runs',
    );
  });

  it('scopes the memory per organization', () => {
    persistAutomationMemory('org-1', '/dashboard/org-1/automations/x/runs');
    expect(readAutomationMemory('org-2')).toBeUndefined();
  });

  it('drops the memory on clear', () => {
    persistAutomationMemory('org-1', '/dashboard/org-1/automations/x/runs');
    clearAutomationMemory('org-1');
    expect(readAutomationMemory('org-1')).toBeUndefined();
  });

  it('ignores corrupted storage rather than throwing', () => {
    window.localStorage.setItem(
      'tale.platform.automations.org-1.lastPath',
      '{not json',
    );
    expect(readAutomationMemory('org-1')).toBeUndefined();
  });

  // Regression: a past write-side bug could persist a pathname belonging to
  // a DIFFERENT section (e.g. Knowledge's `/documents`) under this key. The
  // read side must reject it rather than trust whatever is stored, and clean
  // up so a later read doesn't keep re-validating the same bad value.
  it('rejects and clears a stored path that does not belong to this organization’s automations', () => {
    window.localStorage.setItem(
      'tale.platform.automations.org-1.lastPath',
      JSON.stringify('/dashboard/org-1/documents'),
    );
    expect(readAutomationMemory('org-1')).toBeUndefined();
    expect(
      window.localStorage.getItem('tale.platform.automations.org-1.lastPath'),
    ).toBeNull();
  });
});
