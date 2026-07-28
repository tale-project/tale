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
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Cpu,
  Download,
  Ellipsis,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Share2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { SkillLibraryDialog } from '@/app/features/skills/components/skill-library-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useCopy } from '@/app/hooks/use-copy';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { ArenaVerdict } from '@/lib/shared/arena';
import { cn } from '@/lib/utils/cn';

import { useArenaActions } from '../data/arena-actions';
import { useBranchActions } from '../data/branch-actions';
import {
  useArenaPair,
  useCanvasSources,
  useChatGeneration,
  useChatModelPreference,
  useChatSend,
  useChatThread,
  useChatThreads,
  useComposerCapabilities,
  useComposerModels,
  useHarnessHealth,
  useThreadBranches,
  useThreadCapabilities,
  useThreadFeedback,
  useVoiceMode,
} from '../data/chat-backend';
import { useThreadActions } from '../data/thread-actions';
import { useThreadSharing } from '../data/thread-sharing';
import { useVoiceActions } from '../data/voice-actions';
import { useThreadView } from '../hooks/use-thread-view';
import { useVoiceCapabilities } from '../hooks/use-voice-capabilities';
import {
  useVoiceAudioElement,
  VoiceOutputProvider,
} from '../hooks/voice-output-context';
import {
  forkGroupsForPath,
  forkKey,
  parseBranchSelections,
  resolveViewPath,
} from '../lib/branch-selection';
import type {
  ChatMessageView,
  ComposerModelOption,
  ComposerSelection,
} from '../types';
import { primeAudio } from '../utils/prime-audio';
import { ArenaSplitView } from './arena/arena-split-view';
import { CanvasPanel } from './canvas/canvas-panel';
import { Composer } from './composer';
import {
  directServedModels,
  resolveExternalModelId,
  resolveSelectionSandbox,
  withDefaultModel,
} from './composer-model-picker';
import { ConversationSkeleton } from './conversation-skeleton';
import { ExportChatDialog } from './export-chat-dialog';
import type { MessageForkGroupView } from './message-item';
import { MessageThread } from './message-thread';
import { ThreadList } from './thread-list';
import { VoiceOutputAnnouncer } from './voice-output-announcer';

const NO_SELECTION: ComposerSelection = {
  agentKind: 'platform',
  skills: [],
  connectors: [],
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

export function ChatSurface(props: ChatSurfaceProps) {
  return (
    // The voice provider owns the ONE playback element and the announcer
    // stores; keyed to the open conversation so a thread switch resets any
    // stale playback snapshot.
    <VoiceOutputProvider threadId={props.threadId}>
      <ChatSurfaceInner {...props} />
    </VoiceOutputProvider>
  );
}

function ChatSurfaceInner({
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

  // The URL names the lineage ROOT; which edit/regenerate sibling the
  // conversation shows from each fork point is the root's selection map. The
  // reads below follow the resolved leaf, so flipping the navigator swaps
  // the whole tail. Selections flip locally first (`selectionOverrides`) and
  // persist in the background.
  const branchData = useThreadBranches(organizationId, threadId);
  const branches = useMemo(
    () => (branchData.status === 'ready' ? branchData.data.branches : []),
    [branchData],
  );
  const [selectionOverrides, setSelectionOverrides] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    // A different conversation starts from its own stored choices.
    setSelectionOverrides({});
  }, [threadId]);
  const selections = useMemo(
    () => ({
      ...parseBranchSelections(
        branchData.status === 'ready' ? branchData.data.selections : null,
      ),
      ...selectionOverrides,
    }),
    [branchData, selectionOverrides],
  );
  const viewPath = useMemo(
    () =>
      threadId !== undefined
        ? resolveViewPath(threadId, branches, selections)
        : [],
    [threadId, branches, selections],
  );
  const viewThreadId = threadId !== undefined ? viewPath.at(-1) : undefined;

  const threadView = useThreadView(organizationId, viewThreadId);
  const generation = useChatGeneration(organizationId, viewThreadId);
  // Also answers for a project-shared conversation the caller may read but
  // not write — everything that composes or mutates gates on this.
  const openThread = useChatThread(organizationId, threadId);
  const viewerIsOwner =
    openThread.status !== 'ready' ||
    openThread.data === null ||
    openThread.data.viewerIsOwner !== false;
  const composerOptions = useComposerModels(organizationId);
  const capabilityCatalog = useComposerCapabilities(organizationId);
  const harnessHealth = useHarnessHealth(organizationId);
  const canvas = useCanvasSources(organizationId, threadId);
  const chatSend = useChatSend(organizationId);
  const threadCapabilities = useThreadCapabilities(organizationId);
  const branchActions = useBranchActions(organizationId);

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
  const [exportOpen, setExportOpen] = useState(false);

  // Read replies aloud: the composer checkbox reads the resolved cascade
  // (org veto → thread override → user default) and writes the thread
  // override — or, on the index, the user default. Toggling ON is the iOS
  // gesture that unlocks autoplay, so the audio element primes in the same
  // tick, before any round-trip.
  const voiceMode = useVoiceMode(organizationId, viewThreadId);
  const voiceEnabled = voiceMode.status === 'ready' && voiceMode.data.enabled;
  const voiceVetoed =
    voiceMode.status === 'ready' && voiceMode.data.source === 'org_policy';
  const voiceActions = useVoiceActions(organizationId);
  const voiceCapabilities = useVoiceCapabilities(organizationId);
  const voiceAudioElement = useVoiceAudioElement();
  const handleVoiceOutputChange = (next: boolean) => {
    if (next && voiceAudioElement) primeAudio(voiceAudioElement);
    if (viewThreadId !== undefined) {
      voiceActions.setThreadOverride(viewThreadId, next);
    } else {
      voiceActions.setUserDefault(next);
    }
  };
  const speakAvailable =
    voiceCapabilities.hasTts && !voiceVetoed && viewerIsOwner;

  // The header's Share mirrors the row menu: publish (or refresh) the
  // snapshot link and put the URL on the clipboard in one gesture.
  const sharing = useThreadSharing(organizationId);
  const { copy } = useCopy();
  const handleHeaderShare = async () => {
    if (threadId === undefined) return;
    const shareToken = await sharing.share(threadId);
    if (!shareToken) {
      toast({ title: t('share.shareFailed'), variant: 'destructive' });
      return;
    }
    const url = `${window.location.origin}/dashboard/${organizationId}/chat/shared/${shareToken}`;
    if (await copy(url)) {
      toast({ title: t('share.copied') });
    }
  };

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

  // Arena Mode. The pair is SERVER state: the split view mounts while the
  // uncached pair watch answers non-null and collapses the moment settle
  // clears it — every tab at once. Column A's model is the composer's own
  // pick; column B's lives here, seeded to the first other direct model.
  const { locale } = useLocale();
  const arenaPair = useArenaPair(organizationId, viewThreadId);
  const pair = arenaPair.status === 'ready' ? arenaPair.data : null;
  const arenaActions = useArenaActions(organizationId);
  const [arenaModelB, setArenaModelB] = useState<
    { id: string; providerSlug: string } | undefined
  >(undefined);
  useEffect(() => {
    setArenaModelB(undefined);
  }, [viewThreadId]);
  const directModels = useMemo(() => directServedModels(models), [models]);
  const arenaAvailable =
    selection.agentKind === 'platform' &&
    activeThread?.kind !== 'sandbox' &&
    viewerIsOwner &&
    directModels.length >= 2;
  const arenaModelBId =
    arenaModelB?.id ??
    directModels.find((model) => model.id !== selection.modelId)?.id ??
    selection.modelId;
  // Column B's liveness feeds the verdict bar and the send gate; column A's
  // rides the existing view-thread generation read.
  const generationB = useChatGeneration(
    organizationId,
    pair !== null ? pair.threadIdB : undefined,
  );
  const arenaBusyB =
    generationB.status === 'ready' && generationB.data !== null;

  const handleArenaSettle = async (verdict?: ArenaVerdict) => {
    if (viewThreadId === undefined) return;
    const result = await arenaActions.settle(viewThreadId, verdict);
    if ('refused' in result) {
      toast({
        title: t(
          result.refused === 'busy' ? 'arena.busy' : 'arena.verdictError',
        ),
        variant: 'destructive',
      });
      return;
    }
    if (verdict !== undefined) toast({ title: t('arena.verdictRecorded') });
    // The surviving A is already on screen; only a winning B navigates.
    if (result.continueThreadId !== viewThreadId) {
      void navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId: result.continueThreadId },
      });
    }
  };

  const handleArenaChange = (next: boolean) => {
    if (!next) {
      if (pair !== null) void handleArenaSettle(undefined);
      return;
    }
    void (async () => {
      // On the index the pair needs a conversation first — created bare,
      // so the first send fans into both columns instead of running solo.
      let target = viewThreadId;
      if (target === undefined) {
        const created = await arenaActions.createThread(projectId);
        if (created === null) {
          toast({ title: t('arena.startFailed'), variant: 'destructive' });
          return;
        }
        target = created;
        void navigate({
          to: '/dashboard/$id/chat/$threadId',
          params: { id: organizationId, threadId: created },
        });
      }
      const result = await arenaActions.ensurePair(target);
      if ('refused' in result) {
        toast({
          title: t(
            result.refused === 'busy'
              ? 'arena.busy'
              : result.refused === 'shared'
                ? 'arena.unsharable'
                : 'arena.startFailed',
          ),
          variant: 'destructive',
        });
      }
    })();
  };

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
  const messagesAvailable = threadView.status === 'ready';
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
  // each message's toolbar. Keyed to the VIEW thread: ratings live on the
  // sibling actually rendered.
  const threadFeedback = useThreadFeedback(organizationId, viewThreadId);
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
    (threadId !== undefined && threadView.status === 'unavailable') ||
    // A project-shared conversation someone else owns is read-only here.
    !viewerIsOwner ||
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

  const handleSend = (text: string, intoThreadId?: string) => {
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
    // A live pair fans the prompt into BOTH columns through the arena
    // action; the ordinary single-thread path never runs during arena.
    if (
      pair !== null &&
      viewThreadId !== undefined &&
      intoThreadId === undefined
    ) {
      if (selection.modelId === undefined || arenaModelBId === undefined) {
        return;
      }
      const modelIdA = selection.modelId;
      void arenaActions
        .startTurn({
          threadId: viewThreadId,
          userText: text,
          modelIdA,
          modelIdB: arenaModelBId,
          ...(selection.providerSlug !== undefined
            ? { providerSlugA: selection.providerSlug }
            : {}),
          ...(arenaModelB?.providerSlug !== undefined
            ? { providerSlugB: arenaModelB.providerSlug }
            : {}),
          locale,
        })
        .then(({ a, b }) => {
          const failed = [a, b].find((side) => side.status === 'refused');
          if (failed === undefined) return;
          toast({
            title: t('toast.sendFailed'),
            ...(failed.reason !== undefined
              ? { description: failed.reason }
              : {}),
            variant: 'destructive',
          });
        });
      return;
    }
    // A composer send continues the VIEW thread (the sibling on screen); an
    // edit passes its fresh branch explicitly.
    const target = intoThreadId ?? viewThreadId;
    const modelIdToSend =
      selection.agentKind === 'external' ? externalModelId : selection.modelId;
    void (async () => {
      try {
        const turn = await chatSend.start({
          ...(target !== undefined ? { threadId: target } : {}),
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

  /** Flip a fork point locally and persist the choice in the background. */
  const rememberSelection = (
    parentId: string,
    sequence: number,
    chosen: string,
  ) => {
    if (threadId === undefined) return;
    const key = forkKey(parentId, sequence);
    setSelectionOverrides((previous) => ({ ...previous, [key]: chosen }));
    branchActions.select(threadId, key, chosen);
  };

  // The ‹ n/m › groups along the view path, keyed by message sequence.
  const forkGroups = useMemo(() => {
    if (threadId === undefined || viewPath.length === 0) return undefined;
    const view = new Map<number, MessageForkGroupView>();
    for (const [sequence, group] of forkGroupsForPath(viewPath, branches)) {
      view.set(sequence, {
        index: group.currentIndex,
        total: group.siblings.length,
        onSelect: (nextIndex) => {
          const chosen = group.siblings[nextIndex];
          if (chosen === undefined) return;
          const key = forkKey(group.parentId, group.forkSequence);
          setSelectionOverrides((previous) => ({ ...previous, [key]: chosen }));
          branchActions.select(threadId, key, chosen);
        },
      });
    }
    return view;
    // rememberSelection is stable per render and derived from the same deps.
  }, [threadId, viewPath, branches, branchActions]);

  // Edit = a sibling branch carrying the history BEFORE the edited message;
  // the edited text is then sent into it through the normal turn.
  const handleEditSubmit = (message: ChatMessageView, text: string) => {
    if (viewThreadId === undefined) return;
    const parentId = viewThreadId;
    void branchActions.branchForEdit(parentId, message.id).then((branchId) => {
      if (branchId === null) {
        toast({ title: t('toast.sendFailed'), variant: 'destructive' });
        return;
      }
      rememberSelection(parentId, message.sequence, branchId);
      handleSend(text, branchId);
    });
  };

  // Try again = a sibling branch carrying the history THROUGH the prompt the
  // reply answered, re-run first-class (no synthetic edit).
  const handleRegenerate = (message: ChatMessageView) => {
    if (viewThreadId === undefined || selection.modelId === undefined) return;
    const parentId = viewThreadId;
    const rows = threadView.items;
    const prompt = rows
      .toReversed()
      .find((row) => row.role === 'user' && row.sequence < message.sequence);
    if (!prompt) return;
    const modelId = selection.modelId;
    const providerSlug = selection.providerSlug;
    void branchActions
      .branchForRegenerate(parentId, message.id)
      .then(async (branchId) => {
        if (branchId === null) {
          toast({ title: t('regenerateFailed'), variant: 'destructive' });
          return;
        }
        rememberSelection(parentId, prompt.sequence, branchId);
        const outcome = await branchActions.regenerate(
          branchId,
          modelId,
          providerSlug,
        );
        if (outcome.refused) {
          toast({
            title: t('regenerateFailed'),
            ...(outcome.reason !== undefined
              ? { description: outcome.reason }
              : {}),
            variant: 'destructive',
          });
        }
      });
  };

  // Fork = a VISIBLE copy of the conversation up to a message — a new chat
  // of its own, unlike the hidden siblings above.
  const handleFork = (message: ChatMessageView) => {
    if (viewThreadId === undefined) return;
    const title = t('forkOf', {
      title: activeThread?.title ?? t('history.untitled'),
    });
    void branchActions
      .fork(viewThreadId, message.id, title)
      .then((newThreadId) => {
        if (newThreadId === null) {
          toast({ title: t('forkFailed'), variant: 'destructive' });
          return;
        }
        toast({ title: t('forkSuccess') });
        void navigate({
          to: '/dashboard/$id/chat/$threadId',
          params: { id: organizationId, threadId: newThreadId },
        });
      });
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
            <div className="min-w-0 flex-1" />
            {threadId !== undefined && (
              <div className="pointer-events-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  onClick={() => void handleHeaderShare()}
                  className={cn(
                    'text-muted-foreground gap-1.5',
                    // A pair cannot be shared — settle first (server-enforced;
                    // the control disappears rather than failing on click).
                    pair !== null && 'hidden',
                  )}
                >
                  <Share2 aria-hidden className="size-4" />
                  {t('share.button')}
                </Button>
                <DropdownMenu
                  align="end"
                  trigger={
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('moreActions')}
                    >
                      <Ellipsis className="text-muted-foreground size-5 p-0.25" />
                    </Button>
                  }
                  items={[
                    [
                      {
                        type: 'item',
                        label: t('export.button'),
                        icon: Download,
                        onClick: () => setExportOpen(true),
                      },
                    ],
                  ]}
                />
              </div>
            )}
          </div>
        </div>
        {pair !== null && viewThreadId !== undefined ? (
          <ArenaSplitView
            organizationId={organizationId}
            threadIdA={pair.threadIdA}
            threadIdB={pair.threadIdB}
            modelALabel={
              models.find((model) => model.id === selection.modelId)?.label
            }
            models={models}
            modelBId={arenaModelBId}
            onModelBChange={(id, providerSlug) =>
              setArenaModelB({ id, providerSlug })
            }
            generating={generationInFlight || arenaBusyB}
            onVerdict={(verdict) => void handleArenaSettle(verdict)}
            onExit={() => void handleArenaSettle(undefined)}
          />
        ) : messagesAvailable ? (
          <Stack gap={0} className="min-h-0 min-w-0 flex-1">
            {!viewerIsOwner && (
              <Text
                role="note"
                variant="muted"
                className="border-border bg-muted/40 mx-auto mt-2 w-fit rounded-full border px-4 py-1.5 text-xs md:mt-14"
              >
                {t('readOnlyShared')}
              </Text>
            )}
            <MessageThread
              messages={threadView.items}
              generation={threadView.generation ?? undefined}
              organizationId={organizationId}
              threadId={viewerIsOwner ? viewThreadId : undefined}
              feedback={viewerIsOwner ? feedbackByMessage : undefined}
              forkGroups={viewerIsOwner ? forkGroups : undefined}
              onEditSubmit={viewerIsOwner ? handleEditSubmit : undefined}
              // Regenerating picks the composer's current DIRECT model — a
              // sandbox thread's turns run elsewhere, so it has no re-run here.
              onRegenerate={
                viewerIsOwner && activeThread?.kind !== 'sandbox'
                  ? handleRegenerate
                  : undefined
              }
              onFork={viewerIsOwner ? handleFork : undefined}
              voiceEnabled={voiceEnabled && viewerIsOwner}
              speakAvailable={speakAvailable}
              // Clears the floating glass bar at rest; scrolled content still
              // passes beneath its blur (overflow clips at the padding box).
              className={viewerIsOwner ? 'md:pt-13' : undefined}
            />
          </Stack>
        ) : threadId !== undefined ? (
          threadView.status === 'unavailable' ? (
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
              arenaBusyB ||
              !threadsAvailable ||
              (threadId !== undefined && !messagesAvailable)
            }
            onOpenSkillLibrary={() => setSkillLibraryOpen(true)}
            voiceOutput={voiceEnabled}
            onVoiceOutputChange={handleVoiceOutputChange}
            voiceOutputHidden={voiceVetoed || pair !== null}
            voiceOutputAvailable={voiceCapabilities.hasTts}
            {...(arenaAvailable || pair !== null
              ? {
                  arenaActive: pair !== null,
                  onArenaChange: handleArenaChange,
                }
              : {})}
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

      {/* Same on-demand mounting; exports read the view thread — the sibling
          actually on screen. */}
      {exportOpen && viewThreadId !== undefined && (
        <ExportChatDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          organizationId={organizationId}
          threadId={viewThreadId}
          threadTitle={activeThread?.title}
        />
      )}

      {/* One polite live region narrating voice playback transitions. */}
      <VoiceOutputAnnouncer />

      <CanvasPanel
        sources={canvas.status === 'ready' ? canvas.data : undefined}
      />
    </div>
  );
}
