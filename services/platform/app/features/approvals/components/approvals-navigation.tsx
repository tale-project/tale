'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface ApprovalsNavigationProps {
  organizationId: string;
}

const STATUSES = ['pending', 'resolved'] as const;

export function ApprovalsNavigation({
  organizationId,
}: ApprovalsNavigationProps) {
  const { t } = useT('approvals');

  const navigationItems: TabNavigationItem[] = STATUSES.map((status) => ({
    label: t(`status.${status}`),
    href: `/dashboard/${organizationId}/approvals/${status}`,
  }));

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="py-2"
      prefetch
    />
  );
}
