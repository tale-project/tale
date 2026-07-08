'use client';

import { useSearch } from '@tanstack/react-router';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

/** The Automations list's two content filters. */
export type AutomationsTab = 'installed' | 'all';

export const DEFAULT_AUTOMATIONS_TAB: AutomationsTab = 'installed';

/** Narrow an unvalidated `?tab=` (the layout reads search non-strictly) to the
 *  closed union — anything else falls back to the default tab. */
export function asAutomationsTab(value: unknown): AutomationsTab {
  return value === 'all' ? 'all' : DEFAULT_AUTOMATIONS_TAB;
}

/**
 * Automations' header tab strip — the SAME shared `TabNavigation` every other
 * main page renders (Knowledge, Conversations, Agents), rather than the pill
 * tabs the catalog toolbar used to own. Both tabs share one pathname and switch
 * on `?tab=`, so each item carries an explicit `isActive`: path matching alone
 * would light up both.
 */
export function AutomationsNavigation({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const search: Record<string, unknown> = useSearch({ strict: false });
  const activeTab = asAutomationsTab(search.tab);
  const href = `/dashboard/${organizationId}/automations`;

  const navigationItems: TabNavigationItem[] = [
    {
      label: t('tabs.installed'),
      href,
      search: { tab: 'installed' },
      isActive: activeTab === 'installed',
    },
    {
      label: t('tabs.all'),
      href,
      search: { tab: 'all' },
      isActive: activeTab === 'all',
    },
  ];

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.automationsNavigation')}
    />
  );
}
