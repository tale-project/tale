'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface ConversationsNavigationProps {
  organizationId: string;
}

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

export function ConversationsNavigation({
  organizationId,
}: ConversationsNavigationProps) {
  const { t } = useT('conversations');

  const navigationItems: TabNavigationItem[] = STATUSES.map((status) => ({
    label: t(`status.${status}` as `status.${(typeof STATUSES)[number]}`),
    href: `/dashboard/${organizationId}/conversations/${status}`,
  }));

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="h-12 py-3"
      prefetch
    />
  );
}
