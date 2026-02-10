'use client';

import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useNavigate } from '@tanstack/react-router';
import { Clock, Search, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/app/components/ui/overlays/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useChatLayout } from '@/app/features/chat/context/chat-layout-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ChatHistorySidebar } from './chat-history-sidebar';
import { ChatSearchDialog } from './chat-search-dialog';

interface ChatHeaderProps {
  organizationId: string;
}

export function ChatHeader({ organizationId }: ChatHeaderProps) {
  const navigate = useNavigate();
  const { isHistoryOpen, setIsHistoryOpen } = useChatLayout();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
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

  const findShortcut = useMemo(() => (isMac ? '⌘ K' : 'CTRL + K'), [isMac]);
  const newChatShortcut = useMemo(
    () => (isMac ? '⌥ ⌘ N' : 'ALT + CTRL + N'),
    [isMac],
  );
  const historyShortcut = useMemo(() => (isMac ? '⌘ H' : 'CTRL + H'), [isMac]);

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
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  }, [navigate, organizationId]);

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

  const baseIconClasses = 'size-5 text-muted-foreground p-0.25';

  return (
    <>
      <Sheet open={isMobileHistoryOpen} onOpenChange={setIsMobileHistoryOpen}>
        <SheetContent side="left" hideClose className="w-[18rem] p-0 md:hidden">
          <VisuallyHidden>
            <SheetTitle>{tChat('chatHistory')}</SheetTitle>
          </VisuallyHidden>
          <ChatHistorySidebar
            organizationId={organizationId}
            onChatSelect={handleChatSelect}
          />
        </SheetContent>
      </Sheet>

      <div className="border-border hidden h-13 items-center gap-1 border-b px-5 md:flex">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleToggleHistory}
                aria-label={tChat('chatHistory')}
                className={cn(
                  isHistoryOpen && 'bg-accent text-accent-foreground',
                )}
              >
                <Clock
                  className={cn(
                    baseIconClasses,
                    isHistoryOpen && 'text-accent-foreground',
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="py-1.5">
              {isHistoryOpen ? tChat('hideHistory') : tChat('showHistory')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {historyShortcut}
              </span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleToggleSearch}
                aria-label={tChat('searchChat')}
              >
                <Search className={baseIconClasses} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="py-1.5">
              {isSearchOpen ? tChat('hideSearch') : tChat('searchChat')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {findShortcut}
              </span>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleNewChat}
                aria-label={tChat('newChat')}
              >
                <Plus className={baseIconClasses} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="py-1.5">
              {tChat('newChat')}
              <span className="text-muted bg-muted-foreground/60 ml-3 rounded-sm px-1 py-0.5 text-xs">
                {newChatShortcut}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <AdaptiveHeaderRoot className="md:hidden">
        <div className="flex flex-1 justify-end">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleHistory}
            aria-label={tChat('chatHistory')}
          >
            <Clock className={baseIconClasses} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleSearch}
            aria-label={tChat('searchChat')}
          >
            <Search className={baseIconClasses} />
          </Button>
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
    </>
  );
}
