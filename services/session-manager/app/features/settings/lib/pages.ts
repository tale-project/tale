import { Bot, Palette, SlidersHorizontal, type LucideIcon } from 'lucide-react';

export type SettingsPageKey = 'general' | 'appearance' | 'aiAccess';

export interface SettingsPageDef {
  key: SettingsPageKey;
  /** The page's route, which is also what the panel's highlight rests on. */
  path: '/settings/general' | '/settings/appearance' | '/settings/ai-access';
  icon: LucideIcon;
}

/**
 * The fixed pages of the Settings section, in the order of its panel. One list
 * for the panel, the header that names the open page and the phone's list, so
 * the three cannot drift.
 */
export const SETTINGS_PAGES = [
  { key: 'general', path: '/settings/general', icon: SlidersHorizontal },
  { key: 'appearance', path: '/settings/appearance', icon: Palette },
  { key: 'aiAccess', path: '/settings/ai-access', icon: Bot },
] as const satisfies readonly SettingsPageDef[];

export const FIRST_SETTINGS_PAGE = SETTINGS_PAGES[0];

/** The page a path shows (a trailing slash does not matter), if it is one. */
export function pageAt(pathname: string): SettingsPageDef | undefined {
  const path = pathname.replace(/\/+$/, '');
  return SETTINGS_PAGES.find((page) => page.path === path);
}
