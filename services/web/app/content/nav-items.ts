/**
 * Pure builders for header Platform / Resources menu rows. Desktop NavMenu
 * and the mobile drawer both call these so labels/paths stay in lockstep.
 */

import type { LucideIcon } from 'lucide-react';

import { RESOURCES_DOCS_ITEM, RESOURCES_MENU } from '@/app/content/nav-menus';
import {
  NAV_DROPDOWN_PAGES,
  getPlatformIcon,
  type PlatformPageDef,
  type PlatformPageId,
} from '@/app/content/platform-pages';
import { getDocsUrl } from '@/lib/docs-url';
import type { SupportedLocale } from '@/lib/i18n/locales';
import type { LocalizedRoutePath } from '@/lib/seo/route-paths';

interface PlatformNavItem {
  id: PlatformPageId;
  path: PlatformPageDef['path'];
  navKey: PlatformPageDef['navKey'];
  icon: LucideIcon;
}

interface ResourcesNavItem {
  id: string;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  path?: LocalizedRoutePath;
  href?: string;
}

/** Platform dropdown rows — icon resolved once for desktop + mobile. */
export function buildPlatformNavItems(): readonly PlatformNavItem[] {
  return NAV_DROPDOWN_PAGES.map((page) => ({
    id: page.id,
    path: page.path,
    navKey: page.navKey,
    icon: getPlatformIcon(page.id),
  }));
}

/** Resources rows — localized docs first, then supporting destinations. */
export function buildResourcesNavItems(
  locale: SupportedLocale = 'en',
): readonly ResourcesNavItem[] {
  return [
    {
      id: RESOURCES_DOCS_ITEM.id,
      href: getDocsUrl(locale),
      labelKey: RESOURCES_DOCS_ITEM.labelKey,
      descriptionKey: RESOURCES_DOCS_ITEM.descriptionKey,
      icon: RESOURCES_DOCS_ITEM.icon,
    },
    ...RESOURCES_MENU.items.map((item) => ({
      id: item.id,
      path: item.path,
      labelKey: item.labelKey,
      descriptionKey: item.descriptionKey,
      icon: item.icon,
    })),
  ];
}
