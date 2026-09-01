'use client';

import type { ReactNode } from 'react';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { DEFAULT_COUNT_CAP } from '@/backend/core/lib/helpers/count_items_in_org';
import { useT } from '@/lib/i18n/client';

import { useApproxConversationCountByStatus } from '../hooks/queries';

interface ConversationsNavigationProps {
  organizationId: string;
  /** Trailing action pinned to the right of the tab row (e.g. Compose). */
  action?: ReactNode;
}

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

function CountBadge({ count }: { count: number }) {
  return (
    <span className="bg-muted text-muted-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums">
      {count >= DEFAULT_COUNT_CAP ? `${DEFAULT_COUNT_CAP}+` : count}
    </span>
  );
}

export function ConversationsNavigation({
  organizationId,
  action,
}: ConversationsNavigationProps) {
  const { t } = useT('conversations');

  // Per-status approximate counts. These share the subscription primed by the
  // parent route loader's prefetch, so they paint without a refetch on first
  // nav, and surface as a trailing badge on each tab.
  const counts: Record<(typeof STATUSES)[number], number | undefined> = {
    open: useApproxConversationCountByStatus(organizationId, 'open').data,
    closed: useApproxConversationCountByStatus(organizationId, 'closed').data,
    spam: useApproxConversationCountByStatus(organizationId, 'spam').data,
    archived: useApproxConversationCountByStatus(organizationId, 'archived')
      .data,
  };

  const navigationItems: TabNavigationItem[] = STATUSES.map((status) => {
    const count = counts[status];
    return {
      label: t(`status.${status}`),
      href: `/dashboard/${organizationId}/conversations/${status}`,
      trailing:
        count !== undefined && count > 0 ? (
          <CountBadge count={count} />
        ) : undefined,
    };
  });

  return (
    <TabNavigation items={navigationItems} standalone={false} prefetch>
      {action}
    </TabNavigation>
  );
}
