'use client';

import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
} from '@tale/ui/search';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { useSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { createChatSearchSource } from '@/app/features/chat/data/chat-search-source';
import { useSearchShortcut } from '@/app/hooks/use-search-shortcut';
import { useT } from '@/lib/i18n/client';

export interface ChatSearchCommandProps {
  organizationId: string;
}

/**
 * Chat-scoped search palette — chats only, opened from the thread list. ⌘K /
 * Ctrl+K and the sidebar search icon open the global palette instead; this
 * surface links out to that escape hatch.
 */
export function ChatSearchCommand({ organizationId }: ChatSearchCommandProps) {
  const { isChatSearchOpen, setChatSearchOpen, setSearchOpen } = useSidebar();
  const navigate = useNavigate();
  const { t } = useT('chat');
  const globalShortcut = useSearchShortcut();

  const searchSource = useMemo(
    () => createChatSearchSource({ organizationId }),
    [organizationId],
  );

  const searchLabels = useMemo<Partial<SearchCommandLabels>>(
    () => ({
      title: t('searchPalette.title'),
      placeholder: t('searchPalette.placeholder'),
      loading: t('searchPalette.loading'),
      noResultsTitle: t('searchPalette.noResults'),
      empty: t('searchPalette.empty'),
      emptyHint: t('searchPalette.emptyHint'),
    }),
    [t],
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      void navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId: result.id },
      });
    },
    [navigate, organizationId],
  );

  const openGlobalSearch = useCallback(() => {
    setChatSearchOpen(false);
    setSearchOpen(true);
  }, [setChatSearchOpen, setSearchOpen]);

  const footerAccessory = (
    <div className="border-border-base bg-bg-elevated/40 text-fg-subtle border-t px-4 py-2">
      <button
        type="button"
        onClick={openGlobalSearch}
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated focus-visible:ring-fg-base/40 flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span>
          <span className="text-fg-base block text-sm font-medium">
            {t('searchPalette.searchEverywhere')}
          </span>
          <span className="text-fg-subtle mt-0.5 block leading-snug">
            {t('searchPalette.searchEverywhereHint')}
          </span>
        </span>
        <kbd className="border-border-base bg-bg-base text-fg-base hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          {globalShortcut}
        </kbd>
      </button>
    </div>
  );

  return (
    <SearchCommand
      open={isChatSearchOpen}
      onOpenChange={setChatSearchOpen}
      source={searchSource}
      labels={searchLabels}
      recentsStorageKey="tale.platform.chat.searchPalette.recentSearches.v1"
      minQueryLength={2}
      onSelect={handleSelect}
      footerAccessory={footerAccessory}
    />
  );
}
