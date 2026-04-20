'use client';

import { useNavigate } from '@tanstack/react-router';
import {
  Clock,
  Download,
  Ellipsis,
  Search,
  Share,
  Plus,
  SquarePen,
} from 'lucide-react';
import { useEffect, useState, useCallback, useMemo } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useChatLayout } from '@/app/features/chat/context/chat-layout-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ChatHistorySidebar } from './chat-history-sidebar';
import { ChatSearchDialog } from './chat-search-dialog';
import { ExportChatDialog } from './export-chat-dialog';
import { ShareChatDialog } from './share-chat-dialog';
interface ChatHeaderProps {
  organizationId: string;
  threadId?: string;
}

export function ChatHeader({ organizationId, threadId }: ChatHeaderProps) {
  const navigate = useNavigate();
  const { isHistoryOpen, setIsHistoryOpen, clearChatState } = useChatLayout();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  const { t: tChat } = useT('chat');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const platform = (
        navigator.platform ||
        navigator.userAgent ||
        ''
      ).toLowerCase();
      setIsMac(platform.includes('mac'));
    }
  }, []);

  const findShortcut = isMac ? '⌘ K' : 'CTRL + K';
  const newChatShortcut = isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N';
  const historyShortcut = isMac ? '⌘ H' : 'CTRL + H';

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => !prev);
  }, []);

  const handleToggleHistory = useCallback(() => {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      setIsMobileHistoryOpen((prev) => !prev);
    } else {
      setIsHistoryOpen(!isHistoryOpen);
    }
  }, [isHistoryOpen, setIsHistoryOpen]);

  const handleNewChat = useCallback(() => {
    clearChatState();
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  }, [navigate, organizationId, clearChatState]);

  const handleChatSelect = useCallback(() => {
    setIsMobileHistoryOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        handleToggleSearch();
        return;
      }
      if (isMod && e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        handleNewChat();
      }
      if (isMod && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        e.stopPropagation();
        handleToggleHistory();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, handleToggleSearch, handleNewChat, handleToggleHistory]);

  const headerMenuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: tChat('export.button'),
          icon: Download,
          onClick: () => setIsExportDialogOpen(true),
        },
      ],
    ],
    [tChat],
  );

  const baseIconClasses = 'size-5 text-muted-foreground p-0.25';

  return (
    <>
      <Sheet
        open={isMobileHistoryOpen}
        onOpenChange={setIsMobileHistoryOpen}
        side="left"
        title={tChat('chatHistory')}
        className="w-[18rem] p-0 md:hidden"
        hideClose
      >
        <ChatHistorySidebar
          organizationId={organizationId}
          onChatSelect={handleChatSelect}
          className="h-full"
        />
      </Sheet>

      <div className="border-border hidden h-13 items-center gap-1 border-b px-5 md:flex">
        <Tooltip
          content={
            <>
              {isHistoryOpen ? tChat('hideHistory') : tChat('showHistory')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {historyShortcut}
              </span>
            </>
          }
          side="bottom"
          contentClassName="py-1.5"
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleHistory}
            aria-label={
              isHistoryOpen ? tChat('hideHistory') : tChat('showHistory')
            }
            className={cn(isHistoryOpen && 'bg-accent text-accent-foreground')}
          >
            <Clock
              className={cn(
                baseIconClasses,
                isHistoryOpen && 'text-accent-foreground',
              )}
            />
          </Button>
        </Tooltip>

        <Tooltip
          content={
            <>
              {isSearchOpen ? tChat('hideSearch') : tChat('searchChat')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {findShortcut}
              </span>
            </>
          }
          side="bottom"
          contentClassName="py-1.5"
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleSearch}
            aria-label={tChat('searchChat')}
          >
            <Search className={baseIconClasses} />
          </Button>
        </Tooltip>

        <Tooltip
          content={
            <>
              {tChat('newChat')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {newChatShortcut}
              </span>
            </>
          }
          side="bottom"
          contentClassName="py-1.5"
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={handleNewChat}
            aria-label={tChat('newChat')}
          >
            <SquarePen className={baseIconClasses} />
          </Button>
        </Tooltip>

        {threadId && (
          <>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsShareDialogOpen(true)}
              aria-label={tChat('share.button')}
              className="text-muted-foreground gap-1.5"
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
                >
                  <Ellipsis className={baseIconClasses} />
                </Button>
              }
              items={headerMenuItems}
              align="end"
            />
          </>
        )}
      </div>

      <AdaptiveHeaderRoot className="md:hidden">
        <div className="flex flex-1 justify-end">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleHistory}
            aria-label={
              isMobileHistoryOpen ? tChat('hideHistory') : tChat('showHistory')
            }
          >
            <Clock
              className={cn(
                baseIconClasses,
                isMobileHistoryOpen && 'text-accent-foreground',
              )}
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleSearch}
            aria-label={tChat('searchChat')}
          >
            <Search className={baseIconClasses} />
          </Button>
          {threadId && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsShareDialogOpen(true)}
                aria-label={tChat('share.button')}
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
                items={headerMenuItems}
                align="end"
              />
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={handleNewChat}
            aria-label={tChat('newChat')}
          >
            <Plus className={baseIconClasses} />
          </Button>
        </div>
      </AdaptiveHeaderRoot>

      <ChatSearchDialog
        isOpen={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        organizationId={organizationId}
      />

      {threadId && (
        <>
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
