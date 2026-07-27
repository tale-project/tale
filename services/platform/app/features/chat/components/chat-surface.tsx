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
import { Cpu, PanelLeftClose, PanelLeftOpen, PlugZap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { SkillLibraryDialog } from '@/app/features/skills/components/skill-library-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
  useThreadCapabilities,
  useThreadFeedback,
} from '../data/chat-backend';
import { useThreadActions } from '../data/thread-actions';
import type { ComposerModelOption, ComposerSelection } from '../types';
import { CanvasPanel } from './canvas/canvas-panel';
import { Composer } from './composer';
import {
  resolveExternalModelId,
  resolveSelectionSandbox,
  withDefaultModel,
} from './composer-model-picker';
import { ConversationSkeleton } from './conversation-skeleton';
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
  const ability = useAbility();
  // Mirrors the settings rail's gate for the AI-providers page: whoever can
  // open that page gets pointed at it; everyone else is told to ask an admin.
  const canManageProviders = ability.can('read', 'developerSettings');

  const threads = useChatThreads(organizationId);
  const messages = useChatMessages(organizationId, threadId);
  const generation = useChatGeneration(organizationId, threadId);
  const composerOptions = useComposerModels(organizationId);
  const capabilityCatalog = useComposerCapabilities(organizationId);
  const harnessHealth = useHarnessHealth(organizationId);
  const canvas = useCanvasSources(organizationId, threadId);
  const chatSend = useChatSend(organizationId);
  const threadCapabilities = useThreadCapabilities(organizationId);

  // The circuit-breaker set: harnesses the health signal flags as recently
  // failing, so the agent picker can mark them.
  const degradedHarnesses = new Set(
    harnessHealth.status === 'ready'
      ? harnessHealth.data.filter((h) => h.degraded).map((h) => h.harness)
      : [],
  );
  const modelPreference = useChatModelPreference(organizationId);

  const [selection, setSelection] = useState(NO_SELECTION);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);

  // Chat sub-panel (thread list) visibility on desktop, toggled from the
  // conversation column. Org-scoped, NOT user-scoped, on purpose: the
  // pre-hydration script in index.html reads this exact key before auth (or
  // any JS bundle) runs to decide whether the served boot shell shows the
  // panel skeleton — it can't know the user id. Panel visibility is layout
  // chrome, device-scoped like `tale-theme`.
  const [isHistoryPanelOpen, setHistoryPanelOpen] = usePersistedState(
    `chat-history-panel-open-${organizationId}`,
    true,
  );

  // Keep the pre-hydration `boot-chat` / `boot-chat-panel-open` markers (set
  // by the inline script in index.html) honest live mirrors of "a chat
  // surface is on screen" / "…with the panel open": they gate every chat
  // placeholder (boot shell, access-resolving layout) — the composer
  // stand-in and the sub-panel stand-in respectively — so a placeholder
  // rendered after a runtime toggle or an org switch must reflect the
  // current state, not the page-load snapshot. Removed on unmount —
  // non-chat surfaces render neither.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('boot-chat');
    root.classList.toggle('boot-chat-panel-open', isHistoryPanelOpen);
    return () => {
      root.classList.remove('boot-chat');
      root.classList.remove('boot-chat-panel-open');
    };
  }, [isHistoryPanelOpen]);

  const models =
    composerOptions.status === 'ready'
      ? composerOptions.data.models
      : NO_MODELS;

  // The thread being viewed, once the list has answered. A thread FIXES its
  // agent for its whole life — a sandbox thread keeps its external agent, a
  // direct thread stays platform — so the composer follows the open thread
  // rather than resetting to the platform default when the surface remounts
  // on navigation (which silently sent the next turn to the wrong lane).
  const activeThread =
    threadId !== undefined && threads.status === 'ready'
      ? threads.data.find((thread) => thread.id === threadId)
      : undefined;
  const threadPinsExternalAgent =
    activeThread?.kind === 'sandbox' && activeThread.harness !== undefined;

  // Align the selection with the open thread the moment it loads: a sandbox
  // thread pins its external agent; a fresh sandbox thread the surface just
  // created (harness known, list not yet refetched) keeps the harness the
  // user picked. This runs once per (thread, harness) — a pick the user then
  // makes in-session is left alone by the model-seed effect below.
  useEffect(() => {
    if (!threadPinsExternalAgent || activeThread?.harness === undefined) return;
    const harness = activeThread.harness;
    setSelection((previous) =>
      previous.agentKind === 'external' && previous.harness === harness
        ? previous
        : { ...previous, agentKind: 'external', harness },
    );
  }, [threadPinsExternalAgent, activeThread?.harness]);

  // Hydrate the capability picks from the open thread once its row loads.
  // The assembly LIVES on the thread (`threads.capabilities`) and the surface
  // remounts between the index and `$threadId`, so without this the menu
  // reset to empty right after the first send — while the turn kept running
  // with the set frozen on the row. Runs once per thread; toggles made
  // in-session are left alone (a row echo arriving after a toggle must not
  // wrestle the hand that just made it).
  const capabilitiesHydratedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (threadId === undefined || activeThread === undefined) return;
    if (capabilitiesHydratedFor.current === threadId) return;
    capabilitiesHydratedFor.current = threadId;
    const stored = activeThread.capabilities;
    setSelection((previous) => ({
      ...previous,
      skills: stored?.skills ?? [],
      connectors: stored?.connectors ?? [],
    }));
  }, [threadId, activeThread]);

  // Seed the default model once BOTH the listing and the user's sticky pick
  // have answered, so the seed lands once — never "first model, then the
  // saved one a beat later". Both lanes run a model — the external lane
  // derives its direct-served pick from this same seed — so an external-agent
  // thread seeds too. A pick made in this session is left alone.
  const preference = modelPreference.preference;
  useEffect(() => {
    if (models.length === 0 || preference.status === 'loading') return;
    const preferredId =
      preference.status === 'ready' ? preference.data : undefined;
    setSelection((previous) => withDefaultModel(previous, models, preferredId));
  }, [models, preference]);

  // An explicit model pick becomes the user's sticky default; the seeding
  // effect above writes nothing, so only real choices persist.
  const handleSelectionChange = (next: ComposerSelection) => {
    if (next.modelId !== undefined && next.modelId !== selection.modelId) {
      modelPreference.save(next.modelId);
    }
    // A capability toggle in an open thread persists on the thread row the
    // moment it is made — the next turn reads the row, and a remounted
    // surface re-hydrates from it. (On the index there is no row yet; the
    // picks travel with the send into `createThread`.) The menu builds fresh
    // arrays per toggle, so identity is the change signal.
    if (
      threadId !== undefined &&
      (next.skills !== selection.skills ||
        next.connectors !== selection.connectors)
    ) {
      // The user's own toggle outranks the row: mark the thread hydrated so
      // a thread list that answers AFTER the toggle (deep link, slow query)
      // cannot clobber the fresher hand-made pick with the stale row.
      capabilitiesHydratedFor.current = threadId;
      threadCapabilities.save(threadId, {
        skills: next.skills,
        connectors: next.connectors,
      });
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

  // The caller's ratings for the open conversation — one watch, latched by
  // each message's toolbar.
  const threadFeedback = useThreadFeedback(organizationId, threadId);
  const feedbackByMessage = useMemo(() => {
    const map = new Map<string, 'positive' | 'negative'>();
    if (threadFeedback.status === 'ready') {
      for (const row of threadFeedback.data) map.set(row.messageId, row.rating);
    }
    return map;
  }, [threadFeedback]);

  // Clear the unread dot while the conversation is on screen: on open, and
  // again the moment a running turn settles (the settle is what stamped the
  // reply watermark this read clears against).
  const threadActions = useThreadActions(organizationId);
  const generationSettled =
    generation.status === 'ready' && generation.data === null;
  useEffect(() => {
    if (threadId === undefined || !generationSettled) return;
    threadActions.markRead(threadId);
  }, [threadId, generationSettled, threadActions]);

  // The composer locks only while nothing behind it could EVER serve: the
  // seam is unreachable, the backend answered unavailable, or there is no
  // provider to send through. Reads that are merely still loading do NOT
  // lock it — the field renders ready and takes text immediately; only
  // sending waits for them (below), so a navigation never flashes a dead
  // composer.
  const composerDisabled =
    !chatSend.available ||
    threads.status === 'unavailable' ||
    (threadId !== undefined && messages.status === 'unavailable') ||
    needsProviderSetup;

  // Stop is wired for external turns only — the harness runs independently in the
  // sandbox, so it can be cancelled mid-flight; the direct lane's single-action
  // turn has no cancel yet. The composer shows the stop button accordingly.
  const externalTurnInFlight =
    generationInFlight && selection.agentKind === 'external';
  const handleStop = () => {
    if (threadId === undefined) return;
    void chatSend.stop(threadId).catch((error: unknown) => {
      console.error('[chat] could not stop the turn', error);
      toast({ title: t('toast.sendFailed'), variant: 'destructive' });
    });
  };

  // The model an external turn runs on: the explicit pick when the managed
  // lane can serve it, else the first direct-served model — mirrors the
  // backend's own fallback, so what is sent is what the picker displayed.
  const externalModelId = resolveExternalModelId(selection, models);

  const handleSend = (text: string) => {
    // Each kind has its prerequisites: a model for the platform agent; a
    // harness plus a direct-served model for an external agent.
    // `sendDisabled` already gates these; the guard here keeps a race from
    // slipping through.
    if (selection.agentKind === 'platform' && selection.modelId === undefined)
      return;
    if (
      selection.agentKind === 'external' &&
      (selection.harness === undefined || externalModelId === undefined)
    )
      return;
    const modelIdToSend =
      selection.agentKind === 'external' ? externalModelId : selection.modelId;
    void (async () => {
      try {
        const turn = await chatSend.start({
          ...(threadId !== undefined ? { threadId } : {}),
          text,
          agentKind: selection.agentKind,
          ...(modelIdToSend !== undefined ? { modelId: modelIdToSend } : {}),
          // The provider pick travels only with the model it was made for —
          // the external fallback model resolves its own provider.
          ...(selection.providerSlug !== undefined &&
          modelIdToSend === selection.modelId
            ? { providerSlug: selection.providerSlug }
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
      {/* The panel folds to zero width while the fixed-width inner column
          keeps its layout, so the fold is a clip, not a reflow. */}
      <SubPanel
        as="nav"
        width="wide"
        ariaLabel={t('chatsSection')}
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
          <ThreadList
            organizationId={organizationId}
            threads={threadsAvailable ? threads.data : []}
            activeThreadId={threadId}
            available={threadsAvailable}
          />
        </div>
      </SubPanel>

      <Stack gap={0} className="relative min-h-0 min-w-0 flex-1">
        {/* Frosted floating toggle: an absolute overlay on the message
            column, so content scrolls BENEATH the blur. The glass layer is
            taller than the controls row and dissolves to transparent —
            gradient tint + a mask on the backdrop blur — and pointer-events
            pass through everywhere except the button. Desktop-only: below
            `md` the panel itself is hidden. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden md:block">
          <div
            aria-hidden
            className="from-background/75 absolute inset-x-0 top-0 h-18 bg-gradient-to-b to-transparent [mask-image:linear-gradient(to_bottom,black_40%,transparent)] backdrop-blur-md"
          />
          <div className="relative flex h-13 items-center px-4">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setHistoryPanelOpen((open) => !open)}
              aria-label={
                isHistoryPanelOpen ? t('hideHistory') : t('showHistory')
              }
              aria-expanded={isHistoryPanelOpen}
              aria-controls="chat-sub-panel"
              className="pointer-events-auto -ml-2"
            >
              {isHistoryPanelOpen ? (
                <PanelLeftClose className="text-muted-foreground size-5 p-0.25" />
              ) : (
                <PanelLeftOpen className="text-muted-foreground size-5 p-0.25" />
              )}
            </Button>
          </div>
        </div>
        {messagesAvailable ? (
          <MessageThread
            messages={messages.data}
            generation={
              generation.status === 'ready' ? generation.data : undefined
            }
            organizationId={organizationId}
            threadId={threadId}
            feedback={feedbackByMessage}
            // Clears the floating glass bar at rest; scrolled content still
            // passes beneath its blur (overflow clips at the padding box).
            className="md:pt-13"
          />
        ) : threadId !== undefined ? (
          messages.status === 'unavailable' ? (
            <EmptyState
              icon={PlugZap}
              title={t('backendUnavailable.title')}
              description={t('backendUnavailable.description')}
              headingLevel={2}
              className="min-h-0 flex-1"
            />
          ) : (
            // The open thread's messages are on their way — message-shaped
            // masks in place, never an outage notice (or a bare spinner) for
            // an answer that is merely in flight.
            <ConversationSkeleton
              label={t('loadingConversation')}
              className="md:pt-13"
            />
          )
        ) : needsProviderSetup ? (
          <EmptyState
            icon={Cpu}
            title={t('providerSetup.title')}
            description={t(
              canManageProviders
                ? 'providerSetup.descriptionAdmin'
                : 'providerSetup.descriptionMember',
            )}
            headingLevel={2}
            className="min-h-0 flex-1"
            // Only whoever can actually open the providers page gets the
            // shortcut; pointing everyone else at a page they cannot read
            // is a dead end.
            {...(canManageProviders
              ? {
                  action: (
                    <Button asChild>
                      <Link
                        to="/dashboard/$id/settings/providers"
                        params={{ id: organizationId }}
                      >
                        {t('providerSetup.action')}
                      </Link>
                    </Button>
                  ),
                }
              : {})}
          />
        ) : threads.status === 'unavailable' ? (
          <EmptyState
            icon={PlugZap}
            title={t('backendUnavailable.title')}
            description={t('backendUnavailable.description')}
            headingLevel={2}
            className="min-h-0 flex-1"
          />
        ) : (
          // The index IS a conversation about to start: the same welcome an
          // open thread shows before its first message. It also holds while
          // the model listing is still answering, so the surface never flips
          // welcome → provider-setup → welcome across navigations.
          <MessageThread messages={[]} className="md:pt-13" />
        )}

        <div className="shrink-0 px-4 pb-4">
          <Composer
            models={models}
            externalAgents={
              composerOptions.status === 'ready'
                ? composerOptions.data.externalAgents
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
            generating={externalTurnInFlight}
            disabled={composerDisabled}
            // An open thread's agent is fixed for its life — switching agents
            // is a new chat — so the agent picker locks once a thread exists.
            lockAgent={activeThread !== undefined}
            // Send waits for the kind's prerequisites (a model; a harness
            // plus a direct-served model), for the running turn to settle,
            // and for the reads a correct send needs: the thread list (an
            // open sandbox thread pins its agent from its row — sending
            // before the row loads would run the wrong lane) and the open
            // thread's messages. Typing and the pickers stay usable
            // throughout.
            sendDisabled={
              (selection.agentKind === 'platform'
                ? selection.modelId === undefined
                : selection.harness === undefined ||
                  externalModelId === undefined) ||
              generationInFlight ||
              !threadsAvailable ||
              (threadId !== undefined && !messagesAvailable)
            }
            onOpenSkillLibrary={() => setSkillLibraryOpen(true)}
          />
        </div>
      </Stack>

      {/* Mounted only while open: its skill reads are Convex actions, and a
          closed library must cost a chat view nothing. */}
      {skillLibraryOpen && (
        <SkillLibraryDialog
          organizationId={organizationId}
          open={skillLibraryOpen}
          onOpenChange={setSkillLibraryOpen}
        />
      )}

      <CanvasPanel
        sources={canvas.status === 'ready' ? canvas.data : undefined}
      />
    </div>
  );
}
