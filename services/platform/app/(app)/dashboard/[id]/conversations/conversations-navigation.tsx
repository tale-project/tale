'use client';

import { useT } from '@/lib/i18n';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/components/ui/tab-navigation';

interface ConversationsNavigationProps {
  organizationId: string;
}

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

export default function ConversationsNavigation({
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
      className="top-0 py-3 h-12"
      prefetch
    />
  );
}
