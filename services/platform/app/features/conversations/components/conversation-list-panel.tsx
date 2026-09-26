import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import type { ReactNode } from 'react';

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
        // Phones only: on desktop the Home panel beside the page lists the
        // conversations, so the inbox page is its reading pane alone.
        'border-border relative flex w-full flex-col border-r md:hidden',
        hidden ? 'hidden' : 'flex',
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
