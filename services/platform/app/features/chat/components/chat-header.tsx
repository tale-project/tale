'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { Clock, Search, Plus } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';
import { Button } from '@/app/components/ui/primitives/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/app/components/ui/overlays/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ChatHistorySidebar } from './chat-history-sidebar';
import { ChatSearchDialog } from './chat-search-dialog';

interface ChatHeaderProps {
  organizationId: string;
}

const HISTORY_WIDTH = 288;

export function ChatHeader({ organizationId }: ChatHeaderProps) {
  const navigate = useNavigate();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
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
      setIsHistoryOpen((prev) => !prev);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    navigate({ to: '/dashboard/$id/chat', params: { id: organizationId } });
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

      <div className="hidden md:flex items-start h-full w-fit absolute left-0 top-0 z-10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: isHistoryOpen ? '18rem' : 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className={cn(
            'flex flex-col sticky top-0 h-full w-[18rem] max-w-[calc(100vw-4rem)] border-r border-border overflow-hidden bg-background rounded-tl-xl',
            !isHistoryOpen && 'border-r-0',
          )}
        >
          <ChatHistorySidebar organizationId={organizationId} />
        </motion.div>

        <motion.div
          initial={{ x: -HISTORY_WIDTH }}
          animate={{ x: isHistoryOpen ? 0 : -HISTORY_WIDTH }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ left: `${HISTORY_WIDTH}px` }}
          className="absolute top-0 flex items-center px-5 py-2 bg-background rounded-br-xl"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleToggleHistory}
                  aria-label={tChat('chatHistory')}
                >
                  <Clock className={baseIconClasses} />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                align="start"
                alignOffset={-12}
                side="bottom"
                className="py-1.5"
              >
                {isHistoryOpen ? tChat('hideHistory') : tChat('showHistory')}
                <span className="text-xs text-muted bg-muted-foreground/60 px-1 rounded-sm py-0.5 ml-3">
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
                <span className="text-xs text-muted bg-muted-foreground/60 px-1 rounded-sm py-0.5 ml-3">
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
                <span className="text-xs text-muted bg-muted-foreground/60 px-1 rounded-sm py-0.5 ml-3">
                  {newChatShortcut}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </motion.div>
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
