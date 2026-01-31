'use client';

import { useT } from '@/lib/i18n/client';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';

interface AutomationsListNavigationProps {
  organizationId: string;
}

export function AutomationsListNavigation({
  organizationId,
}: AutomationsListNavigationProps) {
  const { t: tCommon } = useT('common');

  const navigationItems: TabNavigationItem[] = [];

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="py-3 h-12"
      ariaLabel={tCommon('aria.automationsNavigation')}
    />
  );
}
