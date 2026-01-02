'use client';

import { useT } from '@/lib/i18n';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/components/ui/tab-navigation';

interface ApprovalsNavigationProps {
  organizationId: string;
}

const STATUSES = ['pending', 'resolved'] as const;

export function ApprovalsNavigation({
  organizationId,
}: ApprovalsNavigationProps) {
  const { t } = useT('approvals');

  const navigationItems: TabNavigationItem[] = STATUSES.map((status) => ({
    label: t(`status.${status}` as any),
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
