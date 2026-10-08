import { Stack } from '@tale/ui/layout';
import { useIsMobile } from '@tale/ui/use-is-mobile';
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
  const isMobile = useIsMobile();
  // Home already owns the desktop inbox. Keeping a CSS-hidden list mounted
  // still loads row directories, menus and observers for every conversation.
  if (!isMobile || hidden) return null;

  return (
    <div className="border-border relative flex w-full flex-col border-r md:hidden">
      <Stack
        gap={0}
        className="mobile-nav-clearance min-h-0 flex-1 overflow-y-auto pb-[calc(var(--mobile-floating-actions-pad,0px)+var(--mobile-nav-content-pad,0px))]"
      >
        {children}
      </Stack>
      {overlay}
    </div>
  );
}
