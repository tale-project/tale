'use client';

import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';

import { createThreadsSearchSource } from '@/app/features/chat/components/threads-search-source';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';

import { useSidebar } from './sidebar-context';

export interface SidebarSearchCommandProps {
  organizationId: string;
}

/**
 * The shell-level chat-search palette: the shared `@tale/ui` SearchCommand
 * backed by the threads source, plus the single global ⌘K binding. Mounted
 * once (via AppSidebar) so search works on every dashboard route; the source
 * skips all queries while the palette is closed.
 */
export function SidebarSearchCommand({
  organizationId,
}: SidebarSearchCommandProps) {
  const { isSearchOpen, setSearchOpen } = useSidebar();
  const navigate = useNavigate();
  const isMac = useIsMac();
  const { t: tDialogs } = useT('dialogs');
  const { formatDateHeader } = useFormatDate();
  const teamFilter = useOptionalTeamFilter();
  const selectedTeamId = teamFilter?.selectedTeamId ?? undefined;

  // Chat-specific copy comes from the `dialogs.searchChat` keys; the rest of
  // the chrome resolves from the shared `search` namespace.
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(!isSearchOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, isSearchOpen, setSearchOpen]);

  return (
    <SearchCommand
      open={isSearchOpen}
      onOpenChange={setSearchOpen}
      source={threadsSource}
      labels={searchLabels}
      getGroupLabel={(key) => key}
      recentsStorageKey="tale.platform.chat.recentSearches.v1"
      minQueryLength={1}
      onSelect={handleSelectThread}
    />
  );
}
