'use client';

/**
 * Who wrote a reply, when a project agent did: its name above the answer,
 * as a task names the agent that commented (an avatar, the name, an
 * **Agent** mark). The chat assistant's replies carry no such row.
 *
 * A settled reply says who wrote it on its own record (`usage.agent`: the
 * agent and its name at the time), so earlier replies keep their author
 * after a switch, a rename or a delete. A reply still being written has no
 * record yet: it is the conversation's agent's, which the chat surface
 * provides.
 */

import { Avatar } from '@tale/ui/avatar';
import { Badge } from '@tale/ui/badge';
import { createContext, useContext } from 'react';

import { useT } from '@/lib/i18n/client';

import type { ChatMessageItem } from '../types';

/** The agent the open conversation answers as now; null for the
 * assistant, and wherever nobody provides it (a shared view). */
export const ChatAnsweringAgentContext = createContext<{
  readonly id: string;
  readonly name: string;
} | null>(null);

export function ReplyAuthor({ message }: { message: ChatMessageItem }) {
  const { t } = useT('chat');
  const answering = useContext(ChatAnsweringAgentContext);
  const recorded = message.usage?.agent;
  const live =
    message.usage === undefined &&
    (message.status === 'pending' || message.isStreaming);
  const author = recorded ?? (live ? answering : null);
  if (author === null || author === undefined) return null;
  return (
    <div
      data-testid="reply-author"
      className="mb-1 flex min-h-6 min-w-0 items-center gap-2"
    >
      <Avatar kind="agent" size="sm" />
      <span className="text-foreground min-w-0 truncate text-sm font-medium">
        {author.name}
      </span>
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
        {t('replyAuthor.agentBadge')}
      </Badge>
    </div>
  );
}
