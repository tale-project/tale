import type { TFunction } from 'i18next';

/**
 * Localized display name for an agent folder. Known folders have dedicated
 * keys (`agentCatalog.folders.workforce` …); unknown folders fall back to a
 * capitalized form of the raw value so a new department still renders a sane
 * label even before a translation exists. `defaultValue` keeps i18next from
 * surfacing a raw key while the localized string lands. Shared by the catalog
 * sections, the agents list's folder rows, and the folder breadcrumb so the
 * same folder never reads as a raw slug in one place and a name in another
 * (#2348). `t` must be bound to the `agentCatalog` namespace.
 */
export function folderLabel(t: TFunction, folder: string): string {
  const fallback = folder
    ? folder.charAt(0).toUpperCase() + folder.slice(1)
    : t('folders.general', { defaultValue: 'General' });
  if (!folder) return fallback;
  return t(`folders.${folder}`, { defaultValue: fallback });
}
