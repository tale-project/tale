'use client';

import { useEffect } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { ChatHistorySidebar } from './chat-history-sidebar';

export interface ChatSubPanelProps {
  organizationId: string;
}

/**
 * The chat section's sub-panel, mounted by the chat route layout as a
 * full-height sibling of the conversation column (the settings rail is the
 * sibling pattern): the project/chat history lists, with search (⌘K) and
 * new-project affordances on their section headers. New chat lives on the
 * nav rail, not here. Collapsible from the chat top bar (persisted per
 * org — see the key rationale in ChatLayoutProvider): the panel folds to
 * zero width while the fixed-width inner
 * column keeps its layout, so the fold is a clip, not a reflow. Desktop-only
 * — below `md` the unified mobile drawer carries the same content.
 */
export function ChatSubPanel({ organizationId }: ChatSubPanelProps) {
  const { t: tNav } = useT('navigation');
  const { isHistoryPanelOpen } = useChatLayout();

  // Keep the pre-hydration `boot-chat-panel-open` marker (set by the inline
  // script in index.html from the persisted state) an honest live mirror of
  // "a chat surface with the panel open is on screen": it gates every
  // ChatSubPanelPlaceholder (boot shell, access-resolving layout, gate
  // overlays), so a placeholder rendered after a runtime toggle or an org
  // switch must reflect the current state, not the page-load snapshot.
  // Removed on unmount — non-chat surfaces render no panel.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('boot-chat-panel-open', isHistoryPanelOpen);
    return () => root.classList.remove('boot-chat-panel-open');
  }, [isHistoryPanelOpen]);

  return (
    <SubPanel
      as="nav"
      width="wide"
      ariaLabel={tNav('chat')}
      id="chat-sub-panel"
      className={cn(
        '[transition:width_250ms_var(--ease-out-quint)] motion-reduce:transition-none',
        !isHistoryPanelOpen && 'w-0 border-r-0',
      )}
    >
      <div
        inert={!isHistoryPanelOpen || undefined}
        aria-hidden={!isHistoryPanelOpen}
        className="flex h-full w-64 shrink-0 flex-col overflow-hidden"
      >
        <ChatHistorySidebar organizationId={organizationId} />
      </div>
    </SubPanel>
  );
}
