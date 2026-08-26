'use client';

import { Button } from '@tale/ui/button';
import { Search } from 'lucide-react';

import { useOptionalSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

export interface ChatSearchTriggerProps {
  className?: string;
}

/** Opens the chat-scoped search palette from the thread list header. */
export function ChatSearchTrigger({ className }: ChatSearchTriggerProps) {
  const sidebar = useOptionalSidebar();
  const { t } = useT('chat');

  if (!sidebar) return null;

  const label = t('searchPalette.title');

  return (
    <Tooltip content={label} side="right" contentClassName="py-1.5">
      <Button
        size="icon"
        variant="ghost"
        onClick={() => sidebar.setChatSearchOpen(true)}
        aria-label={label}
        className={className ?? 'text-muted-foreground -my-1 size-7 shrink-0'}
      >
        <Search className="size-4" />
      </Button>
    </Tooltip>
  );
}
