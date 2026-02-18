import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface ConversationListPanelProps {
  children: ReactNode;
  hidden?: boolean;
}

export function ConversationListPanel({
  children,
  hidden,
}: ConversationListPanelProps) {
  return (
    <div
      className={cn(
        'relative flex w-full flex-col overflow-y-auto border-r border-border md:max-w-[24.75rem] md:flex-[0_0_24.75rem]',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      {children}
    </div>
  );
}
