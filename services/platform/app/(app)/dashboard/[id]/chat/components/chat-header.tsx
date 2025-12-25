'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { Clock, Search, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import ChatSearchDialog from './chat-search-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import ChatHistorySidebar from './chat-history-sidebar';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface ChatHeaderProps {
  organizationId: string;
}

export default function ChatHeader({ organizationId }: ChatHeaderProps) {
  const router = useRouter();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  // Translations
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
  const handleToggleSearch = () => {
    setIsSearchOpen(!isSearchOpen);
  };

  const handleNewChat = () => {
    router.push(`/dashboard/${organizationId}/chat`);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      // Find: Mod + K
      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        handleToggleSearch();
        return;
      }
      // New Chat: Option + Mod + N
      if (isMod && e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        handleNewChat();
      }
      // Toggle History: Mod + H
      if (isMod && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        e.stopPropagation();
        setIsHistoryOpen(!isHistoryOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, organizationId, isHistoryOpen, isSearchOpen]);

  const baseIconClasses = 'size-5 text-muted-foreground p-0.25';

  return (
    <div className="flex items-start h-full w-fit absolute left-0 top-0 z-10">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: isHistoryOpen ? '18rem' : 0 }}
        transition={{ duration: 0.275 }}
        className={cn(
          'flex flex-col sticky top-0 h-full w-[18rem] border-r border-border overflow-hidden bg-background rounded-tl-xl',
          !isHistoryOpen && 'border-r-0',
        )}
      >
        <ChatHistorySidebar organizationId={organizationId} />
      </motion.div>
      <motion.div
        initial={{ x: -284 }}
        animate={{ x: isHistoryOpen ? 0 : -284 }}
        transition={{ duration: 0.275 }}
        className="absolute top-0 left-[18rem] flex items-center px-5 py-2 bg-background rounded-br-xl"
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
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
      <ChatSearchDialog
        isOpen={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        organizationId={organizationId}
      />
    </div>
  );
}
