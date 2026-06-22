'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import {
  MessagesSquare,
  Download,
  Ellipsis,
  Search,
  Share,
} from 'lucide-react';
import { useEffect, useState, useCallback, useMemo } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useChatLayout } from '@/app/features/chat/context/chat-layout-context';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ChatHistorySidebar } from './chat-history-sidebar';
import { ExportChatDialog } from './export-chat-dialog';
import { ShareChatDialog } from './share-chat-dialog';
import { createThreadsSearchSource } from './threads-search-source';
interface ChatHeaderProps {
  organizationId: string;
  threadId?: string;
}

export function ChatHeader({ organizationId, threadId }: ChatHeaderProps) {
  const navigate = useNavigate();
  const { isHistoryOpen, setIsHistoryOpen } = useChatLayout();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const isMac = useIsMac();

  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');
  const { formatDateHeader } = useFormatDate();
  const teamFilter = useOptionalTeamFilter();
  const selectedTeamId = teamFilter?.selectedTeamId ?? undefined;

  // Chat search now runs on the shared `@tale/ui` SearchCommand, backed by a
  // threads source. Chat-specific copy comes from the `dialogs.searchChat`
  // keys; the rest of the chrome resolves from the shared `search` namespace.
  const threadsSource = useMemo(
    () =>
      createThreadsSearchSource({
        organizationId,
        teamId: selectedTeamId,
        untitledLabel: tDialogs('searchChat.untitledChat'),
        formatGroup: (creationTime) => formatDateHeader(new Date(creationTime)),
      }),
    [organizationId, selectedTeamId, tDialogs, formatDateHeader],
  );

  const searchLabels = useMemo<Partial<SearchCommandLabels>>(
    () => ({
      title: tDialogs('searchChat.title'),
      placeholder: tDialogs('searchChat.placeholder'),
      loading: tDialogs('searchChat.loading'),
      noResultsTitle: tDialogs('searchChat.noResults'),
    }),
    [tDialogs],
  );

  const handleSelectThread = useCallback(
    (result: SearchResult) => {
      void navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId: result.id },
      });
    },
    [navigate, organizationId],
  );

  const findShortcut = isMac ? '⌘ K' : 'CTRL + K';
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
      if (isMod && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        e.stopPropagation();
        handleToggleHistory();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, handleToggleSearch, handleToggleHistory]);

  // The per-thread voice toggle moved to the composer (next to dictation),
  // so the header dropdown now only carries the export action.
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

      <div className="border-border bg-background/95 hidden h-13 items-center border-b px-4 backdrop-blur-xs md:flex">
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
            // Negative margin pulls the icon's glyph to the header's content
            // edge so it lines up with page titles (which start at px-4), since
            // a ghost icon button carries its own p-2 inset. Same idiom as the
            // onboarding wizard's leading Back button.
            className={cn(
              '-ml-2',
              isHistoryOpen && 'bg-accent text-accent-foreground',
            )}
          >
            <MessagesSquare
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

        {threadId && (
          <>
            <div className="flex-1" />
            <Button
              variant="ghost"
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
        <Row gap={0} align="stretch" className="flex-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleToggleHistory}
            title={
              isMobileHistoryOpen ? tChat('hideHistory') : tChat('showHistory')
            }
          >
            <MessagesSquare
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
                items={headerMenuItems}
                align="end"
              />
            </>
          )}
        </Row>
      </AdaptiveHeaderRoot>

      <SearchCommand
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        source={threadsSource}
        labels={searchLabels}
        getGroupLabel={(key) => key}
        recentsStorageKey="tale.platform.chat.recentSearches.v1"
        minQueryLength={1}
        onSelect={handleSelectThread}
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
