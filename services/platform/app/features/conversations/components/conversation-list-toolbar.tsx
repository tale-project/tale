import type { ReactNode } from 'react';

interface ConversationListToolbarProps {
  children: ReactNode;
}

export function ConversationListToolbar({
  children,
}: ConversationListToolbarProps) {
  return (
    <div className="border-border bg-background/50 sticky top-0 z-10 flex h-16 items-center gap-2.5 border-b p-4 backdrop-blur-sm">
      {children}
    </div>
  );
}
