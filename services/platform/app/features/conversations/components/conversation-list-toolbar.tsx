import type { ReactNode } from 'react';

import { PanelHeader } from '@/app/components/layout/panel-header';

interface ConversationListToolbarProps {
  children: ReactNode;
}

export function ConversationListToolbar({
  children,
}: ConversationListToolbarProps) {
  return <PanelHeader className="z-10 gap-2.5">{children}</PanelHeader>;
}
