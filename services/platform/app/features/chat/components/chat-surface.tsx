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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import {
  freezeActiveStream,
  resetGlobalFreeze,
} from '@/app/features/shared/markdown/use-stream-buffer';
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
  useChatGeneration,
  useChatModelPreference,
  useChatSend,
  useChatThread,
  useChatThreads,
  useComposerModels,
  useThreadBranches,
  useThreadReasoningEffort,
  useThreadFeedback,
  useVoiceMode,
} from '../data/chat-backend';
import {
  readEffortPreference,
  writeEffortPreference,
} from '../data/effort-preference';
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
  ChatThreadSummary,
  ChatMessageView,
  ComposerModelOption,
  ComposerSelection,
} from '../types';
import {
  baselineSequenceOf,
  createPendingSend,
  type PendingSend,
} from '../utils/pending-messages';
import { primeAudio } from '../utils/prime-audio';
import { ArenaSplitView } from './arena/arena-split-view';
import { BudgetBanner } from './budget-banner';
import { ChatTranscript } from './chat-transcript';
import { Composer } from './composer';
import { directServedModels, withDefaultModel } from './composer-model-picker';
import { ConversationSkeleton } from './conversation-skeleton';
import { ExportChatDialog } from './export-chat-dialog';
import type { MessageForkGroupView } from './message-item';
import { ThreadList } from './thread-list';
import { VoiceOutputAnnouncer } from './voice-output-announcer';
import { WelcomeView } from './welcome-view';

const NO_SELECTION: ComposerSelection = {};

const NO_MODELS: readonly ComposerModelOption[] = [];
const NO_THREADS: readonly ChatThreadSummary[] = [];

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

  // The optimistic send overlay — set the moment Send is pressed, dropped
  // once the real rows adopted its keys (the consumed effect below).
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  // The force-snap signal the scroll machine consumes: written right before
  // each send (true = instant, for the first message; 'smooth' = the
  // retargeting glide for follow-ups and edits).
  const scrollIntentRef = useRef<boolean | 'smooth'>(false);
  // Arena pair first: while a pair is live the columns own their thread
  // views, and the surface's own view (below) steps aside entirely.
  const arenaPair = useArenaPair(organizationId, viewThreadId);
  const pair = arenaPair.status === 'ready' ? arenaPair.data : null;
  const arenaActive = pair !== null;
  // In arena mode the columns own their thread views — the surface skips
  // its own so a streamed token in either column never re-renders it.
  // Row/adoption facts ONLY — the per-chunk stream text is subscribed by
  // the transcript boundary below, so a streaming turn never re-renders the
  // surface (composer, thread list, header, canvas).
  const threadView = useThreadView(
    organizationId,
    arenaActive ? undefined : viewThreadId,
    pendingSend,
    threadId,
    { includeLiveText: false },
  );
  const generation = useChatGeneration(organizationId, viewThreadId);
  // Also answers for a project-shared conversation the caller may read but
  // not write — everything that composes or mutates gates on this.
  const openThread = useChatThread(organizationId, threadId);
  const viewerIsOwner =
    openThread.status !== 'ready' ||
    openThread.data === null ||
    openThread.data.viewerIsOwner !== false;
  const composerOptions = useComposerModels(organizationId);
  const chatSend = useChatSend(organizationId);
  const threadReasoningEffort = useThreadReasoningEffort(organizationId);
  const branchActions = useBranchActions(organizationId);
  const modelPreference = useChatModelPreference(organizationId);

  const [selection, setSelection] = useState(NO_SELECTION);
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

  // Only models a direct turn can call: a subscription credential is bound
  // to a vendor harness, and the chat page runs no sandbox.
  const models = useMemo(
    () =>
      composerOptions.status === 'ready'
        ? directServedModels(composerOptions.data.models)
        : NO_MODELS,
    [composerOptions],
  );

  // The thread being viewed, once the list has answered.
  const activeThread =
    threadId !== undefined && threads.status === 'ready'
      ? threads.data.find((thread) => thread.id === threadId)
      : undefined;

  // Arena Mode. The pair is SERVER state: the split view mounts while the
  // uncached pair watch answers non-null and collapses the moment settle
  // clears it — every tab at once. Column A's model is the composer's own
  // pick; column B's lives here, seeded to the first other direct model.
  const { locale } = useLocale();
  const arenaActions = useArenaActions(organizationId);
  const [arenaModelB, setArenaModelB] = useState<
    { id: string; providerSlug: string } | undefined
  >(undefined);
  useEffect(() => {
    setArenaModelB(undefined);
  }, [viewThreadId]);
  const arenaAvailable =
    activeThread?.kind !== 'sandbox' && viewerIsOwner && models.length >= 2;
  // The full option, not just the id: the same model id can be served by
  // several providers (the picker deliberately lists every copy), so a bare
  // id would make the backend re-resolve the provider — and pick one the
  // org has no credential for.
  const arenaModelBChoice: { id: string; providerSlug?: string } | undefined =
    arenaModelB ??
    models.find((model) => model.id !== selection.modelId) ??
    (selection.modelId !== undefined
      ? {
          id: selection.modelId,
          ...(selection.providerSlug !== undefined
            ? { providerSlug: selection.providerSlug }
            : {}),
        }
      : undefined);
  const arenaModelBId = arenaModelBChoice?.id;
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

  // Hydrate the effort pick from the open thread once its row loads. The
  // pick LIVES on the thread and the surface remounts between the index and
  // `$threadId`. Runs once per thread; picks made in-session are left alone
  // (a row echo arriving after a pick must not wrestle the hand that just
  // made it).
  const effortHydratedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (threadId === undefined || activeThread === undefined) return;
    if (effortHydratedFor.current === threadId) return;
    effortHydratedFor.current = threadId;
    const storedEffort = activeThread.reasoningEffort;
    setSelection((previous) => ({
      ...previous,
      reasoningEffort: storedEffort,
    }));
  }, [threadId, activeThread]);

  // Seed the effort pick for a NEW chat from the org-local preference the
  // last explicit pick wrote; an open thread hydrates from its row instead.
  const effortSeededRef = useRef(false);
  useEffect(() => {
    if (effortSeededRef.current || threadId !== undefined) return;
    effortSeededRef.current = true;
    const stored = readEffortPreference(organizationId);
    if (stored !== undefined) {
      setSelection((previous) =>
        previous.reasoningEffort === undefined
          ? { ...previous, reasoningEffort: stored }
          : previous,
      );
    }
  }, [threadId, organizationId]);

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
    if (next.reasoningEffort !== selection.reasoningEffort) {
      // An explicit pick seeds future chats and persists on the conversation
      // root (the whole lineage runs with one effort).
      writeEffortPreference(organizationId, next.reasoningEffort ?? null);
      if (threadId !== undefined) {
        effortHydratedFor.current = threadId;
        threadReasoningEffort.save(threadId, next.reasoningEffort ?? null);
      }
    }
    setSelection(next);
  };

  // Drop the overlay once its job is done (the real rows carry its keys).
  const pendingConsumed = threadView.pendingConsumed;
  useEffect(() => {
    if (pendingConsumed) setPendingSend(null);
  }, [pendingConsumed]);

  // An edit swaps the rendered sibling under the reader; when the view lands
  // on the fresh branch, re-arm the smooth snap so the edited message glides
  // to the top even if an earlier content tick consumed the send's intent.
  const editTargetReached =
    pendingSend?.editedFromThreadId !== undefined &&
    viewThreadId === pendingSend.threadId;
  useEffect(() => {
    if (editTargetReached) scrollIntentRef.current = 'smooth';
  }, [editTargetReached]);

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

  // Stop asks the turn to settle with what already streamed: the flag lands
  // on the generation row, the loop reads it back on its next progress write
  // and aborts the in-flight model call.
  const handleStop = () => {
    // Freeze the reveal exactly where it is — the visual stop is immediate
    // even while the server-side settle is still in flight.
    freezeActiveStream();
    if (viewThreadId === undefined) return;
    void chatSend.stop(viewThreadId).catch((error: unknown) => {
      console.error('[chat] could not stop the turn', error);
      toast({ title: t('toast.sendFailed'), variant: 'destructive' });
    });
  };

  const handleSend = (text: string, intoThreadId?: string) => {
    // A turn needs its model. `sendDisabled` already gates this; the guard
    // here keeps a race from slipping through.
    if (selection.modelId === undefined) return;
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
          ...(arenaModelBChoice?.providerSlug !== undefined
            ? { providerSlugB: arenaModelBChoice.providerSlug }
            : {}),
          ...(selection.reasoningEffort !== undefined
            ? { reasoningEffort: selection.reasoningEffort }
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
    const modelIdToSend = selection.modelId;
    // The optimistic rows appear NOW — before any round-trip. An edit's
    // baseline is unknowable (the branch's rows are not loaded yet), so it
    // relies on the text match alone.
    const sentAt = Date.now();
    resetGlobalFreeze();
    scrollIntentRef.current = target === undefined ? true : 'smooth';
    setPendingSend(
      createPendingSend({
        text,
        sentAt,
        ...(target !== undefined ? { threadId: target } : {}),
        baselineSequence:
          target !== undefined && target === viewThreadId
            ? baselineSequenceOf(threadView.items)
            : -1,
        ...(intoThreadId !== undefined && viewThreadId !== undefined
          ? { editedFromThreadId: viewThreadId }
          : {}),
      }),
    );
    void (async () => {
      try {
        const turn = await chatSend.start({
          ...(target !== undefined ? { threadId: target } : {}),
          text,
          modelId: modelIdToSend,
          ...(selection.providerSlug !== undefined
            ? { providerSlug: selection.providerSlug }
            : {}),
          ...(selection.reasoningEffort !== undefined
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
          // Only a NEW conversation can be project-linked; an existing thread
          // keeps the link it was created with.
          ...(threadId === undefined && projectId !== undefined
            ? { projectId }
            : {}),
        });
        if (target === undefined) {
          setPendingSend((previous) =>
            previous !== null && previous.sentAt === sentAt
              ? { ...previous, threadId: turn.threadId }
              : previous,
          );
        }
        // Surface a refusal or a failure; success streams in by itself.
        turn.outcome.then(
          (outcome) => {
            if (outcome.status !== 'refused') return;
            // An early refusal can write no rows at all — drop the overlay
            // so the thinking shell does not linger on a turn that will
            // never answer.
            setPendingSend((previous) =>
              previous !== null && previous.sentAt === sentAt ? null : previous,
            );
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
        setPendingSend((previous) =>
          previous !== null && previous.sentAt === sentAt ? null : previous,
        );
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
  const handleEditSubmitImpl = (message: ChatMessageView, text: string) => {
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
  const handleRegenerateImpl = (message: ChatMessageView) => {
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
          selection.reasoningEffort,
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
  const handleForkImpl = (message: ChatMessageView) => {
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

  // Stable identities for the per-row handlers: the row memo compares them,
  // and a fresh closure per render would re-render every row on every push.
  // The trampoline reads the LATEST implementation from a render-refreshed
  // ref, so stability never means staleness.
  const rowHandlersRef = useRef({
    edit: handleEditSubmitImpl,
    regenerate: handleRegenerateImpl,
    fork: handleForkImpl,
    selectionChange: handleSelectionChange,
    send: handleSend,
    stop: handleStop,
    voiceOutputChange: handleVoiceOutputChange,
  });
  rowHandlersRef.current = {
    edit: handleEditSubmitImpl,
    regenerate: handleRegenerateImpl,
    fork: handleForkImpl,
    selectionChange: handleSelectionChange,
    send: handleSend,
    stop: handleStop,
    voiceOutputChange: handleVoiceOutputChange,
  };
  const handleEditSubmit = useCallback(
    (message: ChatMessageView, text: string) =>
      rowHandlersRef.current.edit(message, text),
    [],
  );
  const handleRegenerate = useCallback(
    (message: ChatMessageView) => rowHandlersRef.current.regenerate(message),
    [],
  );
  const handleFork = useCallback(
    (message: ChatMessageView) => rowHandlersRef.current.fork(message),
    [],
  );
  const stableSelectionChange = useCallback(
    (next: ComposerSelection) => rowHandlersRef.current.selectionChange(next),
    [],
  );
  const stableSend = useCallback(
    (text: string) => rowHandlersRef.current.send(text),
    [],
  );
  const stableStop = useCallback(() => rowHandlersRef.current.stop(), []);
  const stableVoiceOutputChange = useCallback(
    (next: boolean) => rowHandlersRef.current.voiceOutputChange(next),
    [],
  );

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
            threads={threadsAvailable ? threads.data : NO_THREADS}
            activeThreadId={threadId}
            available={threadsAvailable}
          />
        </div>
      </SubPanel>

      <Stack gap={0} className="relative min-h-0 min-w-0 flex-1">
        {/* Floating top bar: an absolute overlay on the message column, so
            content scrolls beneath it. A plain background gradient dissolves
            to transparent — no backdrop blur — and pointer-events pass
            through everywhere except the controls. Desktop-only: below `md`
            the panel itself is hidden. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 hidden md:block">
          <div
            aria-hidden
            className={cn(
              'absolute inset-x-0 top-0',
              // Over the split columns the dissolve reads as haze — arena
              // gets a solid bar with a hard edge instead.
              pair !== null
                ? 'bg-background border-border h-13 border-b'
                : 'from-background via-background/85 h-16 bg-gradient-to-b via-40% to-transparent',
            )}
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
            {/* The open conversation's name, restored to the top bar — the
                0.3 header carried it; truncation keeps long titles polite. */}
            <div className="min-w-0 flex-1 px-3">
              {activeThread?.title !== undefined && (
                <Text
                  variant="muted"
                  className="mx-auto max-w-96 truncate text-center text-sm"
                >
                  {activeThread.title}
                </Text>
              )}
            </div>
            {threadId !== undefined && (
              <div className="pointer-events-auto flex items-center gap-1">
                <DropdownMenu
                  align="end"
                  trigger={
                    <Button
                      size="icon"
                      variant="ghost"
                      // Distinct from the sidebar rows' per-thread "More
                      // actions": a screen reader (and a test locator) must
                      // be able to tell the conversation-level menu apart.
                      aria-label={t('aria.threadActions')}
                    >
                      <Ellipsis className="text-muted-foreground size-5 p-0.25" />
                    </Button>
                  }
                  items={[
                    [
                      // A pair cannot be shared — settle first (server-
                      // enforced; the entry disappears rather than failing).
                      ...(pair === null
                        ? [
                            {
                              type: 'item' as const,
                              label: t('share.button'),
                              icon: Share2,
                              onClick: () => void handleHeaderShare(),
                            },
                          ]
                        : []),
                      {
                        type: 'item' as const,
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
            {...(selection.modelId !== undefined
              ? { modelAId: selection.modelId }
              : {})}
            onModelAChange={(modelId, providerSlug) =>
              // Column A IS the composer's pick — changing it here changes
              // the one selection, so the two controls never disagree.
              handleSelectionChange({ ...selection, modelId, providerSlug })
            }
            models={models}
            modelBId={arenaModelBId}
            onModelBChange={(id, providerSlug) =>
              setArenaModelB({ id, providerSlug })
            }
            generating={generationInFlight || arenaBusyB}
            voiceEnabled={voiceEnabled && speakAvailable}
            onVerdict={(verdict) => void handleArenaSettle(verdict)}
            onExit={() => void handleArenaSettle(undefined)}
          />
        ) : messagesAvailable || threadView.items.length > 0 ? (
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
            <ChatTranscript
              organizationId={organizationId}
              threadId={viewerIsOwner ? viewThreadId : undefined}
              threadRootId={threadId}
              pendingSend={pendingSend}
              dataNoticeOrganizationId={organizationId}
              isGenerating={generationInFlight || pendingSend !== null}
              scrollIntentRef={scrollIntentRef}
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
              // Clears the floating top bar at rest.
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
          // The index IS a conversation about to start: the restored 0.3
          // welcome — a heading and four starters, each a first message. It
          // also holds while the model listing is still answering, so the
          // surface never flips welcome → provider-setup → welcome across
          // navigations.
          <WelcomeView onSuggestionClick={stableSend} />
        )}

        <div className="shrink-0 px-4 pb-4">
          <BudgetBanner organizationId={organizationId} />
          <Composer
            models={models}
            selection={selection}
            onSelectionChange={stableSelectionChange}
            onSend={stableSend}
            onStop={stableStop}
            generating={generationInFlight}
            disabled={composerDisabled}
            // Send waits for its prerequisites: a model, the running turn to
            // settle, and the reads a correct send needs (the thread list and
            // the open thread's messages). Typing and the picker stay usable
            // throughout. In arena the surface deliberately SKIPS its own
            // thread view (the columns each own one), so that read can never
            // become available — the columns' liveness gates (arenaBusyB /
            // generationInFlight) stand in for it.
            sendDisabled={
              selection.modelId === undefined ||
              generationInFlight ||
              arenaBusyB ||
              !threadsAvailable ||
              (threadId !== undefined && !arenaActive && !messagesAvailable)
            }
            voiceOutput={voiceEnabled}
            onVoiceOutputChange={stableVoiceOutputChange}
            voiceOutputHidden={voiceVetoed}
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

      {/* Mounted only while open; exports read the view thread — the sibling
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
    </div>
  );
}
