import { describe, expect, it } from 'vitest';

import { renderHookApp } from '@/tests/utils/render';

import { useSettingsPages } from './use-settings-pages';

describe('useSettingsPages', () => {
  it('words the pages of the section in the person’s language', () => {
    const { result } = renderHookApp(useSettingsPages);

    expect(
      result.current.map(({ path, label, summary }) => ({
        path,
        label,
        summary,
      })),
    ).toEqual([
      {
        path: '/settings/general',
        label: 'General',
        summary: 'Start page and version.',
      },
      {
        path: '/settings/appearance',
        label: 'Appearance',
        summary: 'Theme and language.',
      },
      {
        path: '/settings/ai-access',
        label: 'AI access',
        summary: 'Let AI assistants use Session Manager.',
      },
    ]);
  });

  it('carries the icon and key of each page', () => {
    const { result } = renderHookApp(useSettingsPages);
    expect(result.current.map((page) => page.key)).toEqual([
      'general',
      'appearance',
      'aiAccess',
    ]);
    for (const page of result.current) expect(page.icon).toBeDefined();
  });
});
