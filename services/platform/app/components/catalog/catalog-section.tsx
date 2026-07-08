'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { TFunction } from 'i18next';
import { type ReactNode } from 'react';

/**
 * A titled catalog section (one folder's cards): a real `<h3>` styled as the
 * shared muted caption, over a `gap-3` stack. Every folder-grouped catalog
 * (agents, automations) renders its sections through this so the section
 * chrome — and the heading semantics under the page's `h2` — stay identical.
 */
export function CatalogSection({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack gap={3}>
      <Text
        as="h3"
        variant="caption"
        className="text-muted-foreground font-medium"
      >
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * Group catalog items into sorted `[folder, items[]]` pairs for section
 * rendering. Folders sort alphabetically; the ungrouped bucket (`''`) always
 * sorts LAST so loose items trail the named sections (rendered under the
 * localized "General" label via {@link folderLabel}).
 */
export function groupCatalogItems<T>(
  items: readonly T[],
  getFolder: (item: T) => string,
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const folder = getFolder(item);
    const list = groups.get(folder) ?? [];
    list.push(item);
    groups.set(folder, list);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === b[0]) return 0;
    if (a[0] === '') return 1;
    if (b[0] === '') return -1;
    return a[0].localeCompare(b[0]);
  });
}

/**
 * Localized title for a folder section. Known folders have dedicated keys
 * (`folders.github` … in the caller's namespace); unknown folders fall back to
 * a capitalized form of the raw value so a new department still renders a sane
 * label even before a translation exists. `defaultValue` keeps i18next from
 * surfacing a raw key while the localized string lands.
 */
export function folderLabel(t: TFunction, folder: string): string {
  const fallback = folder
    ? folder.charAt(0).toUpperCase() + folder.slice(1)
    : t('folders.general', { defaultValue: 'General' });
  if (!folder) return fallback;
  return t(`folders.${folder}`, { defaultValue: fallback });
}
