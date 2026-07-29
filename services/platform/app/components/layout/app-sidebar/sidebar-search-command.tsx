'use client';

import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';

import { createChatSearchSource } from '@/app/features/chat/data/chat-search-source';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useT } from '@/lib/i18n/client';

import { useSidebar } from './sidebar-context';

export interface SidebarSearchCommandProps {
  organizationId: string;
}

/**
 * The shell-level chat-search palette: the shared `@tale/ui` SearchCommand
 * plus the single global ⌘K binding. Mounted once (via AppSidebar) so the
 * shortcut works on every dashboard route.
 */
export function SidebarSearchCommand({
  organizationId,
}: SidebarSearchCommandProps) {
  const { isSearchOpen, setSearchOpen } = useSidebar();
  const navigate = useNavigate();
  const isMac = useIsMac();
  const { t: tDialogs } = useT('dialogs');

  // Memoised so the hook-shaped source keeps ONE identity per org — the
  // SearchCommand calls it every render and its inner hooks must keep order.
  const chatSearchSource = useMemo(
    () => createChatSearchSource({ organizationId }),
    [organizationId],
  );

  // Chat-specific copy comes from the `dialogs.searchChat` keys; the rest of
  // the chrome resolves from the shared `search` namespace.
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
      source={chatSearchSource}
      labels={searchLabels}
      getGroupLabel={(key) => key}
      recentsStorageKey="tale.platform.chat.recentSearches.v1"
      minQueryLength={2}
      onSelect={handleSelectThread}
    />
  );
}
