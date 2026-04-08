'use client';

import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useMessageProcessing } from '../../hooks/use-message-processing';
import { MessageBubble } from '../message-bubble';
import { ThinkingAnimation } from '../thinking-animation';
import { useArenaMode } from './arena-mode-context';
import { ArenaVerdictBar } from './arena-verdict-bar';

interface ArenaSplitViewProps {
  organizationId: string;
  isLoading: boolean;
}

function ArenaColumn({
  label,
  threadId,
  organizationId,
  isLoading,
}: {
  label: string;
  threadId: string | null;
  organizationId: string;
  isLoading: boolean;
}) {
  const { messages, activeMessage } = useMessageProcessing(
    threadId ?? undefined,
  );

  const assistantMessages = useMemo(
    () => messages.filter((m) => m.role === 'assistant'),
    [messages],
  );

  const hasStreamingMessage = useMemo(
    () => messages.some((m) => m.role === 'assistant' && m.isStreaming),
    [messages],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-border bg-muted/50 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {assistantMessages.map((message) => (
          <MessageBubble
            key={message.key}
            message={{
              id: message.key,
              content: message.content,
              role: 'assistant',
              timestamp: message.timestamp,
              isStreaming: message.isStreaming,
              threadId: threadId ?? undefined,
            }}
            organizationId={organizationId}
          />
        ))}
        {isLoading && !hasStreamingMessage && (
          <ThinkingAnimation streamingMessage={activeMessage} />
        )}
      </div>
    </div>
  );
}

export function ArenaSplitView({
  organizationId,
  isLoading,
}: ArenaSplitViewProps) {
  const { t } = useT('chat');
  const { arenaThreadIdA, arenaThreadIdB } = useArenaMode();

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <ArenaColumn
          label={t('arena.modelALabel')}
          threadId={arenaThreadIdA}
          organizationId={organizationId}
          isLoading={isLoading}
        />
        <div className="bg-border w-px shrink-0" />
        <ArenaColumn
          label={t('arena.modelBLabel')}
          threadId={arenaThreadIdB}
          organizationId={organizationId}
          isLoading={isLoading}
        />
      </div>
      {arenaThreadIdA && arenaThreadIdB && (
        <ArenaVerdictBar
          threadIdA={arenaThreadIdA}
          threadIdB={arenaThreadIdB}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}
