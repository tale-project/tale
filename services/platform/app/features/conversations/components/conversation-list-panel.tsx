import { Stack } from '@tale/ui/layout';
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
        'border-border relative flex w-full flex-col border-r md:max-w-[24.75rem] md:flex-[0_0_24.75rem]',
        hidden ? 'hidden md:flex' : 'flex',
      )}
    >
      <Stack
        gap={0}
        className="min-h-0 flex-1 overflow-y-auto pb-[length:var(--mobile-floating-actions-pad,0px)]"
      >
        {children}
      </Stack>
      {overlay}
    </div>
  );
}
