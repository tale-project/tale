/**
 * Header navigation IA. Desktop menus and the mobile drawer both read from
 * here — add a destination once and every chrome surface picks it up.
 *
 * Platform module rows stay in `platform-pages.ts` (`NAV_DROPDOWN_PAGES`);
 * this file owns the Resources menu and the top-bar shape.
 */

import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Building2,
  GitCompareArrows,
  History,
  BriefcaseBusiness,
} from 'lucide-react';

import { listMarketingContent } from '@/lib/content/client';
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

/** Comparison is a Resources destination whenever its published hub exists. */
export const COMPARISON_NAV_ITEM = listMarketingContent(
  'comparisons',
  'en',
).some((page) => page.slug === 'index')
  ? ({
      id: 'compare',
      path: '/compare',
      labelKey: 'resource.compare.label',
      descriptionKey: 'resource.compare.description',
      icon: GitCompareArrows,
    } as const)
  : null;

/** Resources — docs (external), comparisons, use cases, changelog, about. */
const RESOURCES_MENU_ITEMS: readonly NavMenuItem[] = [
  ...(COMPARISON_NAV_ITEM ? [COMPARISON_NAV_ITEM] : []),
  ...(['use-cases'] as const).flatMap((category): NavMenuItem[] => {
    if (
      !listMarketingContent(category, 'en').some(
        (page) => page.slug === 'index',
      )
    )
      return [];
    return [
      {
        id: 'useCases',
        path: '/use-cases',
        labelKey: 'resource.useCases.label',
        descriptionKey: 'resource.useCases.description',
        icon: BriefcaseBusiness,
      },
    ];
  }),
  {
    id: 'changelog',
    path: '/changelog',
    labelKey: 'resource.changelog.label',
    descriptionKey: 'resource.changelog.description',
    icon: History,
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
