import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { renderHookApp } from '@/tests/utils/render';

import { useQuoted } from './use-quoted';

afterEach(async () => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

describe('useQuoted', () => {
  it('quotes a name the way English does, and lists several with an Oxford comma', () => {
    const { result } = renderHookApp(() => useQuoted());
    expect(result.current.quoted('Shop')).toBe('"Shop"');
    expect(result.current.quotedList(['Shop'])).toBe('"Shop"');
    expect(result.current.quotedList(['Shop', 'Bank'])).toBe(
      '"Shop" and "Bank"',
    );
    expect(result.current.quotedList(['Shop', 'Bank', 'Mail'])).toBe(
      '"Shop", "Bank", and "Mail"',
    );
  });

  it('quotes and lists the way German does', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { result } = renderHookApp(() => useQuoted());
    await waitFor(() => expect(result.current.quoted('Shop')).toBe('„Shop“'));
    expect(result.current.quotedList(['Shop', 'Bank', 'Mail'])).toBe(
      '„Shop“, „Bank“ und „Mail“',
    );
  });

  it('quotes and lists the way French does, with no-break spaces inside the guillemets', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    const { result } = renderHookApp(() => useQuoted());
    await waitFor(() => expect(result.current.quoted('Shop')).toBe('« Shop »'));
    expect(result.current.quotedList(['Shop', 'Bank'])).toBe(
      '« Shop » et « Bank »',
    );
  });
});
