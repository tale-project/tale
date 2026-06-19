'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface AutomationsListNavigationProps {
  organizationId: string;
}

export function AutomationsListNavigation({
  organizationId,
}: AutomationsListNavigationProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  // Mirrors the agents section: List is the default landing, then Catalog and
  // Metrics as sibling tabs.
  const navigationItems: TabNavigationItem[] = [
    {
      label: t('tabs.list'),
      href: `/dashboard/${organizationId}/automations`,
      matchMode: 'exact',
    },
    {
      label: t('tabs.catalog'),
      href: `/dashboard/${organizationId}/automations/catalog`,
      matchMode: 'exact',
    },
    {
      label: t('tabs.metrics'),
      href: `/dashboard/${organizationId}/automations/metrics`,
      matchMode: 'exact',
    },
  ];

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="py-3"
      ariaLabel={tCommon('aria.automationsNavigation')}
    />
  );
}
