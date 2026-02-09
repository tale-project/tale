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
  organizationId: _organizationId,
}: AutomationsListNavigationProps) {
  const { t: tCommon } = useT('common');

  const navigationItems: TabNavigationItem[] = [];

  if (navigationItems.length === 0) {
    return null;
  }

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="h-12 py-3"
      ariaLabel={tCommon('aria.automationsNavigation')}
    />
  );
}
