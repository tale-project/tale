'use client';

import { useT } from '@/lib/i18n/client';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';

interface ConversationsNavigationProps {
  organizationId: string;
}

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

export function ConversationsNavigation({
  organizationId,
}: ConversationsNavigationProps) {
  const { t } = useT('conversations');

  const navigationItems: TabNavigationItem[] = STATUSES.map((status) => ({
    label: t(`status.${status}` as any),
    href: `/dashboard/${organizationId}/conversations/${status}`,
  }));

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      className="py-3 h-12"
      prefetch
    />
  );
}
