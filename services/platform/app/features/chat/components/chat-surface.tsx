'use client';

/**
 * The chat screen: thread list, conversation, composer, and the Canvas.
 *
 * Everything it renders comes through the one Convex seam in
 * `../data/chat-backend`. While that seam reports `unavailable` the screen
 * says so plainly and offers no controls that would silently do nothing —
 * it never shows an empty conversation as if it had loaded one. The one
 * guided state: when the model listing answers and is EMPTY (the org holds
 * no active provider credential), the index points at Settings → AI
 * providers instead of blaming the connection — an empty catalog is a setup
 * gap, not an outage.
 *
 * Sending goes through the seam's write (`useChatSend`): on the index the
 * turn creates its thread and the screen navigates into it; the reply then
 * arrives through the live message/generation subscriptions. The composer
 * seeds itself with a default model the moment the listing answers, so the
 * first message is one keystroke away, and it locks only while nothing
 * behind it could serve — never merely because no thread is open yet.
 */

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Link, useNavigate } from '@tanstack/react-router';
import { Cpu, PlugZap } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useCanvasSources,
  useChatAgents,
  useChatGeneration,
  useChatMessages,
  useChatSend,
  useChatThreads,
  useComposerModels,
} from '../data/chat-backend';
import type { ComposerSelection } from '../types';
import { CanvasPanel } from './canvas/canvas-panel';
import { Composer } from './composer';
import { withDefaultModel } from './composer-model-picker';
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
  const { toast } = useToast();
  const navigate = useNavigate();

  const threads = useChatThreads(organizationId);
  const messages = useChatMessages(organizationId, threadId);
  const generation = useChatGeneration(organizationId, threadId);
  const composerOptions = useComposerModels(organizationId);
  const agents = useChatAgents(organizationId);
  const canvas = useCanvasSources(organizationId, threadId);
  const chatSend = useChatSend(organizationId);

  const [selection, setSelection] = useState(NO_SELECTION);

  // Seed the default model the moment the listing answers, so sending never
  // requires a menu visit. A pick the user already made is left alone.
  useEffect(() => {
    if (composerOptions.status !== 'ready') return;
    const models = composerOptions.data.models;
    if (models.length === 0) return;
    setSelection((previous) => withDefaultModel(previous, models));
  }, [composerOptions]);

  const threadsAvailable = threads.status === 'ready';
  const messagesAvailable = messages.status === 'ready';
  // The model listing ANSWERED and came back empty: the org has no active
  // provider credential, so nothing could reply. Only the index shows the
  // setup guidance — with a thread open, a missing conversation is a
  // connection problem, not a catalog one.
  const needsProviderSetup =
    threadId === undefined &&
    composerOptions.status === 'ready' &&
    composerOptions.data.models.length === 0;

  const generationInFlight =
    generation.status === 'ready' && generation.data !== null;

  // The composer locks only while nothing behind it could serve: the seam is
  // unreachable, an open thread hasn't loaded, or there is no provider to
  // send through. An index with no thread selected is NOT such a state.
  const composerDisabled =
    !chatSend.available ||
    !threadsAvailable ||
    (threadId !== undefined && !messagesAvailable) ||
    needsProviderSetup;

  const handleSend = (text: string) => {
    const modelId = selection.modelId;
    if (modelId === undefined) return;
    void (async () => {
      try {
        const turn = await chatSend.start({
          ...(threadId !== undefined ? { threadId } : {}),
          text,
          modelId,
          sandbox: selection.sandbox,
          ...(selection.agentSlug !== undefined
            ? { agentSlug: selection.agentSlug }
            : {}),
        });
        // Surface a refusal or a failure; success streams in by itself.
        turn.outcome.then(
          (outcome) => {
            if (outcome.status !== 'refused') return;
            toast({
              title: t('toast.sendFailed'),
              ...(outcome.reason !== undefined
                ? { description: outcome.reason }
                : {}),
              variant: 'destructive',
            });
          },
          (error: unknown) => {
            console.error('[chat] the turn failed', error);
            toast({ title: t('toast.sendFailed'), variant: 'destructive' });
          },
        );
        if (threadId === undefined) {
          void navigate({
            to: '/dashboard/$id/chat/$threadId',
            params: { id: organizationId, threadId: turn.threadId },
          });
        }
      } catch (error) {
        console.error('[chat] could not start the turn', error);
        toast({ title: t('toast.sendFailed'), variant: 'destructive' });
      }
    })();
  };

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
        ) : needsProviderSetup ? (
          <EmptyState
            icon={Cpu}
            title={t('providerSetup.title')}
            description={t('providerSetup.description')}
            headingLevel={2}
            className="min-h-0 flex-1"
            action={
              <Button asChild>
                <Link
                  to="/dashboard/$id/settings/providers"
                  params={{ id: organizationId }}
                >
                  {t('providerSetup.action')}
                </Link>
              </Button>
            }
          />
        ) : threadId === undefined && threadsAvailable ? (
          // The index IS a conversation about to start: the same welcome an
          // open thread shows before its first message, not an outage notice.
          <MessageThread messages={[]} />
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
            onSend={handleSend}
            disabled={composerDisabled}
            // Send waits for a model pick and for the running turn to settle;
            // typing and the pickers stay usable through both.
            sendDisabled={selection.modelId === undefined || generationInFlight}
          />
        </div>
      </Stack>

      <CanvasPanel
        sources={canvas.status === 'ready' ? canvas.data : undefined}
      />
    </div>
  );
}
