'use client';

import { useCallback } from 'react';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import { useT } from '@/lib/i18n/client';

import { useSidebar } from './sidebar-context';

export interface MobileSidebarSheetProps {
  organizationId: string;
}

/**
 * Mobile chat-history drawer: recent projects and chats. Mounted at shell
 * level (via AppSidebar) so the chat header's hamburger and the ⌘H shortcut
 * can open it from any dashboard route. Primary navigation lives in the
 * always-on bottom tab bar (`MobileBottomNav`), so this drawer no longer
 * repeats the nav destinations.
 */
export function MobileSidebarSheet({
  organizationId,
}: MobileSidebarSheetProps) {
  const { isMobileSheetOpen, setMobileSheetOpen } = useSidebar();
  const { t: tNav } = useT('navigation');
  const handleNavigate = useCallback(() => {
    setMobileSheetOpen(false);
  }, [setMobileSheetOpen]);

  return (
    <Sheet
      open={isMobileSheetOpen}
      onOpenChange={setMobileSheetOpen}
      side="left"
      title={tNav('sidebar.title')}
      className="flex w-[min(100vw,20rem)] flex-col p-0 md:hidden"
      hideClose
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatHistorySidebar
          organizationId={organizationId}
          onChatSelect={handleNavigate}
          className="h-full"
        />
      </div>
    </Sheet>
  );
}
