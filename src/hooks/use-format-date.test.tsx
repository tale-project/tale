import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isDayjsLocaleReady } from '../lib/date/dayjs-setup';
import { useFormatDate } from './use-format-date';

const state = vi.hoisted(() => ({ locale: 'en-US' }));

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: state.locale, setLocale: () => undefined }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

/** Mounts the hook and counts how often its host rendered. */
async function mountCounting() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useFormatDate();
  });
  // Let a locale load (a dynamic import) settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { hook, renders: () => renders };
}

// Lists call this hook once per row. A second render per row after mount —
// to pick up locale data that was already there — doubled what every list
// paid to mount (on a task's comments: every markdown body parsed twice).
describe('useFormatDate', () => {
  it('renders once when its locale needs no data', async () => {
    state.locale = 'en-US';
    const { renders } = await mountCounting();
    expect(renders()).toBe(1);
  });

  it('renders again once its locale data arrives, then never for it again', async () => {
    state.locale = 'fr';
    expect(isDayjsLocaleReady('fr')).toBe(false);

    const first = await mountCounting();
    expect(isDayjsLocaleReady('fr')).toBe(true);
    expect(first.renders()).toBe(2);
    expect(first.hook.result.current.formatDate(new Date(2026, 9, 5))).toBe(
      '5 octobre 2026',
    );

    const second = await mountCounting();
    expect(second.renders()).toBe(1);
  });
});
