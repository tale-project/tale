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
  useChatGeneration,
  useChatMessages,
  useChatModelPreference,
  useChatSend,
  useChatThreads,
  useComposerCapabilities,
  useComposerModels,
  useHarnessHealth,
} from '../data/chat-backend';
import type { ComposerModelOption, ComposerSelection } from '../types';
import { CanvasPanel } from './canvas/canvas-panel';
import { Composer } from './composer';
import {
  resolveSelectionSandbox,
  withDefaultModel,
} from './composer-model-picker';
import { MessageThread } from './message-thread';
import { ThreadList } from './thread-list';

const NO_SELECTION: ComposerSelection = {
  agentKind: 'platform',
  skills: [],
  connectors: [],
  voiceOutput: false,
};

const NO_MODELS: readonly ComposerModelOption[] = [];

interface ChatSurfaceProps {
  organizationId: string;
  /** The open thread, or none on the chat index. */
  threadId?: string;
  /** Start new conversations inside this project (the project's "New chat"
   * flow) — the thread is project-linked at creation, so its agent runs
   * pre-equipped with the project's per-agent binding. */
  projectId?: string;
}

export function ChatSurface({
  organizationId,
  threadId,
  projectId,
}: ChatSurfaceProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const navigate = useNavigate();

  const threads = useChatThreads(organizationId);
  const messages = useChatMessages(organizationId, threadId);
  const generation = useChatGeneration(organizationId, threadId);
  const composerOptions = useComposerModels(organizationId);
  const capabilityCatalog = useComposerCapabilities(organizationId);
  const harnessHealth = useHarnessHealth(organizationId);
  const canvas = useCanvasSources(organizationId, threadId);
  const chatSend = useChatSend(organizationId);

  // The circuit-breaker set: harnesses the health signal flags as recently
  // failing, so the agent picker can mark them.
  const degradedHarnesses = new Set(
    harnessHealth.status === 'ready'
      ? harnessHealth.data.filter((h) => h.degraded).map((h) => h.harness)
      : [],
  );
  const modelPreference = useChatModelPreference(organizationId);

  const [selection, setSelection] = useState(NO_SELECTION);

  const models =
    composerOptions.status === 'ready'
      ? composerOptions.data.models
      : NO_MODELS;

  // The thread being viewed, once the list has answered. A thread FIXES its
  // agent for its whole life — a sandbox thread keeps its coding agent, a
  // direct thread stays platform — so the composer follows the open thread
  // rather than resetting to the platform default when the surface remounts
  // on navigation (which silently sent the next turn to the wrong lane).
  const activeThread =
    threadId !== undefined && threads.status === 'ready'
      ? threads.data.find((thread) => thread.id === threadId)
      : undefined;
  const threadPinsCodingAgent =
    activeThread?.kind === 'sandbox' && activeThread.harness !== undefined;

  // Align the selection with the open thread the moment it loads: a sandbox
  // thread pins its coding agent; a fresh sandbox thread the surface just
  // created (harness known, list not yet refetched) keeps the harness the
  // user picked. This runs once per (thread, harness) — a pick the user then
  // makes in-session is left alone by the model-seed effect below.
  useEffect(() => {
    if (!threadPinsCodingAgent || activeThread?.harness === undefined) return;
    const harness = activeThread.harness;
    setSelection((previous) =>
      previous.agentKind === 'coding' && previous.harness === harness
        ? previous
        : { ...previous, agentKind: 'coding', harness },
    );
  }, [threadPinsCodingAgent, activeThread?.harness]);

  // Seed the default model once BOTH the listing and the user's sticky pick
  // have answered, so the seed lands once — never "first model, then the
  // saved one a beat later". Only the platform agent runs a model, so a
  // coding thread is left alone. A pick made in this session is left alone.
  const preference = modelPreference.preference;
  useEffect(() => {
    if (threadPinsCodingAgent) return;
    if (models.length === 0 || preference.status === 'loading') return;
    const preferredId =
      preference.status === 'ready' ? preference.data : undefined;
    setSelection((previous) => withDefaultModel(previous, models, preferredId));
  }, [threadPinsCodingAgent, models, preference]);

  // An explicit model pick becomes the user's sticky default; the seeding
  // effect above writes nothing, so only real choices persist.
  const handleSelectionChange = (next: ComposerSelection) => {
    if (next.modelId !== undefined && next.modelId !== selection.modelId) {
      modelPreference.save(next.modelId);
    }
    setSelection(next);
  };

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

  // Stop is wired for coding turns only — the harness runs independently in the
  // sandbox, so it can be cancelled mid-flight; the direct lane's single-action
  // turn has no cancel yet. The composer shows the stop button accordingly.
  const codingTurnInFlight =
    generationInFlight && selection.agentKind === 'coding';
  const handleStop = () => {
    if (threadId === undefined) return;
    void chatSend.stop(threadId).catch((error: unknown) => {
      console.error('[chat] could not stop the turn', error);
      toast({ title: t('toast.sendFailed'), variant: 'destructive' });
    });
  };

  const handleSend = (text: string) => {
    // Each kind has one prerequisite: a model for the platform agent, a
    // harness for a coding agent. `sendDisabled` already gates these; the
    // guard here keeps a race from slipping through.
    if (selection.agentKind === 'platform' && selection.modelId === undefined)
      return;
    if (selection.agentKind === 'coding' && selection.harness === undefined)
      return;
    void (async () => {
      try {
        const turn = await chatSend.start({
          ...(threadId !== undefined ? { threadId } : {}),
          text,
          agentKind: selection.agentKind,
          ...(selection.modelId !== undefined
            ? { modelId: selection.modelId }
            : {}),
          ...(selection.harness !== undefined
            ? { harness: selection.harness }
            : {}),
          sandbox: resolveSelectionSandbox(selection, models),
          ...(selection.skills.length > 0 || selection.connectors.length > 0
            ? {
                capabilities: {
                  skills: selection.skills,
                  connectors: selection.connectors,
                },
              }
            : {}),
          // Only a NEW conversation can be project-linked; an existing thread
          // keeps the link it was created with.
          ...(threadId === undefined && projectId !== undefined
            ? { projectId }
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
            models={models}
            sandboxAgents={
              composerOptions.status === 'ready'
                ? composerOptions.data.sandboxAgents
                : []
            }
            skills={
              capabilityCatalog.status === 'ready'
                ? capabilityCatalog.data.skills
                : []
            }
            connectors={
              capabilityCatalog.status === 'ready'
                ? capabilityCatalog.data.connectors
                : []
            }
            selection={selection}
            degradedHarnesses={degradedHarnesses}
            onSelectionChange={handleSelectionChange}
            onSend={handleSend}
            onStop={handleStop}
            generating={codingTurnInFlight}
            disabled={composerDisabled}
            // An open thread's agent is fixed for its life — switching agents
            // is a new chat — so the agent picker locks once a thread exists.
            lockAgent={activeThread !== undefined}
            // Send waits for the kind's one prerequisite (model or harness)
            // and for the running turn to settle; typing and the pickers stay
            // usable through both.
            sendDisabled={
              (selection.agentKind === 'platform'
                ? selection.modelId === undefined
                : selection.harness === undefined) || generationInFlight
            }
          />
        </div>
      </Stack>

      <CanvasPanel
        sources={canvas.status === 'ready' ? canvas.data : undefined}
      />
    </div>
  );
}
