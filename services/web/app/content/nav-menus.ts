/**
 * Header navigation IA. Desktop menus and the mobile drawer both read from
 * here — add a destination once and every chrome surface picks it up.
 *
 * Platform module rows stay in `platform-pages.ts` (`NAV_DROPDOWN_PAGES`);
 * this file owns the Resources menu and the top-bar shape.
 */

import type { LucideIcon } from 'lucide-react';
import { BookOpen, Building2, History, Server } from 'lucide-react';

import type { LocalizedRoutePath } from '@/lib/seo/route-paths';

export type NavMenuId = 'platform' | 'resources';

interface NavMenuItem {
  /** Stable id for React keys. */
  id: string;
  path: LocalizedRoutePath;
  /** i18n key under `nav.*` for the row label. */
  labelKey: string;
  /** i18n key under `nav.*` for the row description. */
  descriptionKey: string;
  icon: LucideIcon;
}

interface NavMenuDef {
  id: NavMenuId;
  /** i18n key under `nav.*` for the trigger label. */
  triggerKey: NavMenuId;
  items: readonly NavMenuItem[];
}

/** Resources — docs (external), changelog, hardware, about. */
const RESOURCES_MENU_ITEMS: readonly NavMenuItem[] = [
  {
    id: 'changelog',
    path: '/changelog',
    labelKey: 'resource.changelog.label',
    descriptionKey: 'resource.changelog.description',
    icon: History,
  },
  {
    id: 'hardware',
    path: '/hardware-pricing',
    labelKey: 'resource.hardware.label',
    descriptionKey: 'resource.hardware.description',
    icon: Server,
  },
  {
    id: 'about',
    path: '/about',
    labelKey: 'resource.about.label',
    descriptionKey: 'resource.about.description',
    icon: Building2,
  },
] as const;

/**
 * Docs deep-link shown as a text row in Resources (external — rendered by
 * the header, not as a LocalizedLink).
 */
export const RESOURCES_DOCS_ITEM = {
  id: 'docs',
  labelKey: 'resource.docs.label',
  descriptionKey: 'resource.docs.description',
  icon: BookOpen,
} as const;

export const RESOURCES_MENU: NavMenuDef = {
  id: 'resources',
  triggerKey: 'resources',
  items: RESOURCES_MENU_ITEMS,
};
