import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { AppWindow } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { renderHookApp } from '@/tests/utils/render';

import { isItemActive, useNavItems, type NavItem } from './use-nav-items';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('useNavItems', () => {
  it('lists the sections in the order of the rail, with Settings apart at its foot', () => {
    const { result } = renderHookApp(useNavItems);

    expect(result.current.primary.map((item) => item.to)).toEqual([
      '/sessions',
      '/proxies',
      '/secrets',
    ]);
    expect(result.current.pinned.map((item) => item.to)).toEqual(['/settings']);
  });

  it('names a section in the language of the person', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { result } = renderHookApp(useNavItems);

    await expect
      .poll(() =>
        [...result.current.primary, ...result.current.pinned].map(
          (item) => item.label,
        ),
      )
      .toEqual(['Sitzungen', 'Proxies', 'Secrets', 'Einstellungen']);
  });
});

describe('isItemActive', () => {
  const sessions: NavItem = {
    to: '/sessions',
    label: 'Sessions',
    icon: AppWindow,
  };

  it.each([
    ['its own page', '/sessions'],
    ['a page beneath it', '/sessions/12'],
    ['a page two levels beneath it', '/sessions/12/stream'],
  ])('is true for %s', (_what, pathname) => {
    expect(isItemActive(sessions, pathname)).toBe(true);
  });

  it.each([
    ['another section', '/proxies'],
    ['a section whose name only starts like it', '/sessions-archive'],
    ['the root', '/'],
  ])('is false for %s', (_what, pathname) => {
    expect(isItemActive(sessions, pathname)).toBe(false);
  });
});
