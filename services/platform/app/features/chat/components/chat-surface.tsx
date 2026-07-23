'use client';

/**
 * The chat screen: thread list, conversation, composer, and the Canvas.
 *
 * Everything it renders comes through the one Convex seam in
 * `../data/chat-backend`. While that seam reports `unavailable` the screen
 * says so plainly and offers no controls that would silently do nothing —
 * it never shows an empty conversation as if it had loaded one.
 */

import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { PlugZap } from 'lucide-react';
import { useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { useT } from '@/lib/i18n/client';

import {
  useCanvasSources,
  useChatAgents,
  useChatGeneration,
  useChatMessages,
  useChatThreads,
  useComposerModels,
} from '../data/chat-backend';
import type { ComposerSelection } from '../types';
import { CanvasPanel } from './canvas/canvas-panel';
import { Composer } from './composer';
import { MessageThread } from './message-thread';
import { ThreadList } from './thread-list';

const NO_SELECTION: ComposerSelection = { sandbox: false, voiceOutput: false };

interface ChatSurfaceProps {
  organizationId: string;
  /** The open thread, or none on the chat index. */
  threadId?: string;
}

export function ChatSurface({ organizationId, threadId }: ChatSurfaceProps) {
  const { t } = useT('chat');

  const threads = useChatThreads(organizationId);
  const messages = useChatMessages(organizationId, threadId);
  const generation = useChatGeneration(organizationId, threadId);
  const composerOptions = useComposerModels(organizationId);
  const agents = useChatAgents(organizationId);
  const canvas = useCanvasSources(organizationId, threadId);

  const [selection, setSelection] = useState(NO_SELECTION);

  const threadsAvailable = threads.status === 'ready';
  const messagesAvailable = messages.status === 'ready';

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      <SubPanel
        as="nav"
        width="wide"
        ariaLabel={t('chatsSection')}
        id="chat-sub-panel"
      >
        <ThreadList
          organizationId={organizationId}
          threads={threadsAvailable ? threads.data : []}
          activeThreadId={threadId}
          available={threadsAvailable}
        />
      </SubPanel>

      <Stack gap={0} className="min-h-0 min-w-0 flex-1">
        {messagesAvailable ? (
          <MessageThread
            messages={messages.data}
            generation={
              generation.status === 'ready' ? generation.data : undefined
            }
          />
        ) : (
          <EmptyState
            icon={PlugZap}
            title={t('backendUnavailable.title')}
            description={t('backendUnavailable.description')}
            headingLevel={2}
            className="min-h-0 flex-1"
          />
        )}

        <div className="shrink-0 px-4 pb-4">
          <Composer
            models={
              composerOptions.status === 'ready'
                ? composerOptions.data.models
                : []
            }
            sandboxAgents={
              composerOptions.status === 'ready'
                ? composerOptions.data.sandboxAgents
                : []
            }
            agents={agents.status === 'ready' ? agents.data : []}
            selection={selection}
            onSelectionChange={setSelection}
            // Sending is wired with the rest of the chat seam; until then the
            // field is disabled rather than accepting text it would drop.
            onSend={() => undefined}
            disabled={!messagesAvailable}
          />
        </div>
      </Stack>

      <CanvasPanel
        sources={canvas.status === 'ready' ? canvas.data : undefined}
      />
    </div>
  );
}
