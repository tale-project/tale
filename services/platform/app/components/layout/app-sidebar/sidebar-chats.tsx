'use client';

import { useEffect, useState } from 'react';

import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import { cn } from '@/lib/utils/cn';

import { labelFadeClass } from './sidebar-motion';

export interface SidebarChatsProps {
  organizationId: string;
  expanded: boolean;
}

/**
 * The chat-history region (projects / chats / archived). Lazy-mounted: users
 * whose sidebar is collapsed never pay the threads/projects/approvals
 * subscriptions; once expanded it stays mounted so re-collapsing is a pure
 * clip + fade (no exit orchestration, instant re-open). While collapsed the
 * region is `inert` + `aria-hidden` so its clipped links leave the tab order.
 */
export function SidebarChats({ organizationId, expanded }: SidebarChatsProps) {
  const [hasMounted, setHasMounted] = useState(expanded);

  useEffect(() => {
    if (expanded) setHasMounted(true);
  }, [expanded]);

  return (
    <div
      inert={!expanded || undefined}
      aria-hidden={!expanded}
      className={cn(
        'border-border mt-2 min-h-0 flex-1 overflow-hidden border-t',
        labelFadeClass(expanded),
      )}
    >
      {hasMounted && (
        <ChatHistorySidebar
          organizationId={organizationId}
          className="h-full"
        />
      )}
    </div>
  );
}
