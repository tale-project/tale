import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface ConversationListPanelProps {
  children: ReactNode;
  overlay?: ReactNode;
  hidden?: boolean;
}

export function ConversationListPanel({
  children,
  overlay,
  hidden,
}: ConversationListPanelProps) {
  return (
    <div
      className={cn(
        'relative flex w-full flex-col border-r border-border md:max-w-[24.75rem] md:flex-[0_0_24.75rem]',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
      {overlay}
    </div>
  );
}
