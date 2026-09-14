import { PanelHeader } from '@tale/ui/panel-header';
import type { ReactNode } from 'react';

interface ConversationListToolbarProps {
  children: ReactNode;
}

export function ConversationListToolbar({
  children,
}: ConversationListToolbarProps) {
  // Keep PanelHeader's default `z-50` — overriding it to `z-10` here tied with
  // the conversation rows' own `z-10` content, so scrolling rows painted over
  // the sticky toolbar (looking like it had no background).
  return <PanelHeader className="gap-2.5">{children}</PanelHeader>;
}
