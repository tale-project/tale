import { describe, expect, it } from 'vitest';

import { FIRST_SETTINGS_PAGE, SETTINGS_PAGES, pageAt } from './pages';

describe('SETTINGS_PAGES', () => {
  it('lists General, Appearance and AI access, in that order', () => {
    expect(SETTINGS_PAGES.map((page) => page.path)).toEqual([
      '/settings/general',
      '/settings/appearance',
      '/settings/ai-access',
    ]);
  });

  it('opens Settings on General', () => {
    expect(FIRST_SETTINGS_PAGE.path).toBe('/settings/general');
  });

  it('gives every page an icon and a key of its own', () => {
    expect(new Set(SETTINGS_PAGES.map((page) => page.key)).size).toBe(3);
    for (const page of SETTINGS_PAGES) expect(page.icon).toBeDefined();
  });
});

describe('pageAt', () => {
  it('finds the page a path shows', () => {
    expect(pageAt('/settings/appearance')?.key).toBe('appearance');
    expect(pageAt('/settings/ai-access')?.key).toBe('aiAccess');
  });

  it('does not mind a trailing slash', () => {
    expect(pageAt('/settings/general/')?.key).toBe('general');
  });

  it('knows no page for the index, another section or an unknown path', () => {
    expect(pageAt('/settings')).toBeUndefined();
    expect(pageAt('/settings/')).toBeUndefined();
    expect(pageAt('/sessions')).toBeUndefined();
    expect(pageAt('/settings/nowhere')).toBeUndefined();
  });
});
