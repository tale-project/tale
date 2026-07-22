'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useChatContextMenu } from '../hooks/use-chat-context-menu';

interface ChatActionsProps {
  chat: {
    id: string;
    title: string;
  };
  currentChatId?: string;
  organizationId: string;
  onRename?: () => void;
  isArchived?: boolean;
  isPinned?: boolean;
  /** The project this chat currently belongs to, if any — the "Move to
   * project" submenu marks it as current and offers "Remove from project". */
  projectId?: string;
}

/**
 * The per-chat "…" menu shown on each sidebar chat row. A thin trigger over the
 * shared {@link useChatContextMenu} (Pin · Rename · Move to project · Archive ·
 * Delete), so the sidebar and the chat header stay in lockstep.
 */
export function ChatActions({
  chat,
  currentChatId,
  organizationId,
  onRename,
  isArchived = false,
  isPinned = false,
  projectId,
}: ChatActionsProps) {
  const { t: tChat } = useT('chat');

  const { items, dialogs, onMenuOpenChange } = useChatContextMenu({
    chat,
    organizationId,
    placement: 'sidebar',
    currentChatId,
    isPinned,
    isArchived,
    projectId,
    onRename,
  });

  return (
    <>
      <DropdownMenu
        align="end"
        onOpenChange={onMenuOpenChange}
        trigger={
          <Button
            variant="ghost"
            className="size-6 p-1"
            size="icon"
            aria-label={tChat('moreActions')}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
        items={items}
      />

      {dialogs}
    </>
  );
}
