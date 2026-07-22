'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import {
  MessagesSquare,
  Ellipsis,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share,
} from 'lucide-react';
import { useState } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { useSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { useThreadHeaderMeta } from '../hooks/queries';
import { useChatContextMenu } from '../hooks/use-chat-context-menu';
import { useChatPanel } from './chat-panel/chat-panel-context';
import { ExportChatDialog } from './export-chat-dialog';
import { ShareChatDialog } from './share-chat-dialog';

interface ChatHeaderProps {
  organizationId: string;
  threadId?: string;
}

/**
 * Chat-surface header. On desktop it always renders: the leading toggle
 * collapses/expands the chat sub-panel (persisted via ChatLayoutProvider),
 * and the per-thread actions (Share + overflow) join it while a thread is
 * open. The mobile bar keeps its hamburger + search buttons, wired to the
 * shared sidebar state (drawer + palette).
 *
 * The overflow "…" is the same menu the sidebar chat rows carry (built by
 * {@link useChatContextMenu}) — View files · Move to project · Pin · Archive ·
 * Export · Delete — so header and sidebar never drift apart.
 */
export function ChatHeader({ organizationId, threadId }: ChatHeaderProps) {
  const { isMobileSheetOpen, setMobileSheetOpen, setSearchOpen } = useSidebar();
  const { isHistoryPanelOpen, toggleHistoryPanel } = useChatLayout();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

  const { t: tChat } = useT('chat');

  const { openPane, visiblePanes } = useChatPanel();
  const meta = useThreadHeaderMeta(threadId, organizationId);
  // The canvas pane registers a descriptor only when the thread has files
  // (branch-aware, including live writes), so this is exactly when
  // `openPane('canvas')` will stick — gate "View files" on it.
  const canvasHasFiles = visiblePanes.some((pane) => pane.id === 'canvas');

  const {
    items: menuItems,
    dialogs: menuDialogs,
    onMenuOpenChange,
  } = useChatContextMenu({
    chat: { id: threadId ?? '', title: meta?.title ?? '' },
    organizationId,
    placement: 'header',
    currentChatId: threadId,
    isPinned: meta?.pinnedAt != null,
    isArchived: meta?.status === 'archived',
    projectId: meta?.projectId ?? undefined,
    viewFiles: {
      visible: canvasHasFiles,
      onSelect: () => openPane('canvas'),
    },
    onExport: () => setIsExportDialogOpen(true),
  });

  const baseIconClasses = 'size-5 text-muted-foreground p-0.25';

  return (
    <>
      {/* Frosted floating bar: an absolute overlay on the message column
          (its parent is `relative` in the chat layout), so content scrolls
          BENEATH the blur. The glass layer is taller than the controls row
          and dissolves to transparent — gradient tint + a mask on the
          backdrop blur, kept on its own layer so the controls stay crisp.
          pointer-events pass through everywhere except the buttons. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden md:block">
        <div
          aria-hidden
          className="from-background/75 absolute inset-x-0 top-0 h-18 bg-gradient-to-b to-transparent [mask-image:linear-gradient(to_bottom,black_40%,transparent)] backdrop-blur-md"
        />
        <div className="relative flex h-13 items-center px-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleHistoryPanel}
            aria-label={
              isHistoryPanelOpen ? tChat('hideHistory') : tChat('showHistory')
            }
            aria-expanded={isHistoryPanelOpen}
            aria-controls="chat-sub-panel"
            className="pointer-events-auto -ml-2"
          >
            {isHistoryPanelOpen ? (
              <PanelLeftClose className={baseIconClasses} />
            ) : (
              <PanelLeftOpen className={baseIconClasses} />
            )}
          </Button>
          <div className="min-w-0 flex-1" />
          {threadId && (
            <>
              <Button
                variant="ghost"
                onClick={() => setIsShareDialogOpen(true)}
                aria-label={tChat('share.button')}
                className="text-muted-foreground pointer-events-auto gap-1.5"
              >
                <Share className="size-4" />
                {tChat('share.button')}
              </Button>
              <DropdownMenu
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tChat('moreActions')}
                    className="pointer-events-auto"
                  >
                    <Ellipsis className={baseIconClasses} />
                  </Button>
                }
                items={menuItems}
                onOpenChange={onMenuOpenChange}
                align="end"
              />
            </>
          )}
        </div>
      </div>

      <AdaptiveHeaderRoot className="md:hidden">
        <Row gap={0} align="stretch" className="flex-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setMobileSheetOpen(!isMobileSheetOpen)}
            aria-label={
              isMobileSheetOpen ? tChat('hideHistory') : tChat('showHistory')
            }
            aria-expanded={isMobileSheetOpen}
          >
            <MessagesSquare
              className={cn(
                baseIconClasses,
                isMobileSheetOpen && 'text-accent-foreground',
              )}
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSearchOpen(true)}
            title={tChat('searchChat')}
          >
            <Search className={baseIconClasses} />
          </Button>
          {threadId && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsShareDialogOpen(true)}
                title={tChat('share.button')}
              >
                <Share className={baseIconClasses} />
              </Button>
              <DropdownMenu
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tChat('moreActions')}
                  >
                    <Ellipsis className={baseIconClasses} />
                  </Button>
                }
                items={menuItems}
                onOpenChange={onMenuOpenChange}
                align="end"
              />
            </>
          )}
        </Row>
      </AdaptiveHeaderRoot>

      {threadId && (
        <>
          {menuDialogs}
          <ExportChatDialog
            open={isExportDialogOpen}
            onOpenChange={setIsExportDialogOpen}
            threadId={threadId}
            organizationId={organizationId}
          />
          <ShareChatDialog
            open={isShareDialogOpen}
            onOpenChange={setIsShareDialogOpen}
            threadId={threadId}
            organizationId={organizationId}
          />
        </>
      )}
    </>
  );
}
