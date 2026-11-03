import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  SETTINGS_PAGES,
  type SettingsPageDef,
  type SettingsPageKey,
} from '../lib/pages';

export interface SettingsPage extends SettingsPageDef {
  /** The page's name: the panel's row, the header's title, the phone's list. */
  label: string;
  /** What the page holds, in a few words (the phone's list). */
  summary: string;
}

/** The pages of the section, worded in the person's language. */
export function useSettingsPages(): readonly SettingsPage[] {
  const { t } = useT('settings');
  return useMemo(() => {
    const words: Record<SettingsPageKey, { label: string; summary: string }> = {
      general: {
        label: t('pages.general.title'),
        summary: t('pages.general.summary'),
      },
      appearance: {
        label: t('pages.appearance.title'),
        summary: t('pages.appearance.summary'),
      },
      aiAccess: {
        label: t('pages.aiAccess.title'),
        summary: t('pages.aiAccess.summary'),
      },
    };
    return SETTINGS_PAGES.map((page) => ({
      key: page.key,
      path: page.path,
      icon: page.icon,
      label: words[page.key].label,
      summary: words[page.key].summary,
    }));
  }, [t]);
}
