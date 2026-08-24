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
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  Cpu,
  Download,
  Ellipsis,
  MessageCircleQuestion,
  MessageSquareOff,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  PlugZap,
  Share2,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SubPanel } from '@/app/components/layout/sub-panel';
import { QuestionFlow } from '@/app/components/ui/forms/question-flow';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { useMyBudgetStatus } from '@/app/features/settings/governance/hooks/queries';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useConvexFileUpload } from '@/app/features/shared/files/use-convex-file-upload';
import {
  freezeActiveStream,
  resetGlobalFreeze,
} from '@/app/features/shared/markdown/use-stream-buffer';
import { useAbility } from '@/app/hooks/use-ability';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { ArenaVerdict } from '@/lib/shared/arena';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
import {
  formatAnswerSetForModel,
  type QuestionAnswer,
} from '@/lib/shared/schemas/questions';
import { cn } from '@/lib/utils/cn';

import { useArenaActions } from '../data/arena-actions';
import { useBranchActions } from '../data/branch-actions';
import {
  useArenaPair,
  useChatGeneration,
  useChatModelPreference,
  useChatProjects,
  useChatSend,
  useChatThread,
  useChatThreads,
  useComposerModels,
  useThreadBranches,
  useThreadHolds,
  useThreadReasoningEffort,
  useThreadFeedback,
  usePendingQuestion,
  useResolveQuestion,
  useVoiceMode,
} from '../data/chat-backend';
import {
  readEffortPreference,
  writeEffortPreference,
} from '../data/effort-preference';
import { useThreadActions } from '../data/thread-actions';
import { useVoiceActions } from '../data/voice-actions';
import { AttachmentPreviewProvider } from '../hooks/attachment-preview-context';
import {
  useChatVideoLinks,
  type VideoLinkJob,
} from '../hooks/use-chat-video-links';
import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '../hooks/use-file-transcription-status';
import {
  moveToProjectMenuItem,
  useThreadMenuActions,
} from '../hooks/use-thread-menu-actions';
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
import { pickMostRecentThread } from '../utils/most-recent-thread';
import {
  baselineSequenceOf,
  createPendingSend,
  type PendingSend,
} from '../utils/pending-messages';
import { primeAudio } from '../utils/prime-audio';
import {
  turnRefusalToastContent,
  turnNamedFailureToastContent,
} from '../utils/turn-error-toast';
import { ArchivedBanner } from './archived-banner';
import { ArenaSplitView } from './arena/arena-split-view';
import { BudgetBanner } from './budget-banner';
import { ChatMessagesErrorBoundary } from './chat-messages-error-boundary';
import { ChatTranscript } from './chat-transcript';
import { Composer, type ComposerHandle } from './composer';
import { directServedModels, withDefaultModel } from './composer-model-picker';
import { ConversationSkeleton } from './conversation-skeleton';
import { DeferredSendTray } from './deferred-send-tray';
import { ExportChatDialog } from './export-chat-dialog';
import type { MessageForkGroupView } from './message-item';
import { SelectionQuoteButton } from './selection-quote-button';
import { ShareChatDialog } from './share-chat-dialog';
import { ThreadDeleteDialog } from './thread-delete-dialog';
import { ThreadList } from './thread-list';
import { VoiceOutputAnnouncer } from './voice-output-announcer';
import { WelcomeView } from './welcome-view';

const NO_SELECTION: ComposerSelection = {};

const NO_MODELS: readonly ComposerModelOption[] = [];
const NO_THREADS: readonly ChatThreadSummary[] = [];

/** How many sent-image previews stay alive for instant rendering before the
 * oldest are revoked — a compressed image is ≤1 MB, so this bounds the held
 * blobs to a few dozen MB in the worst case. */
const SENT_PREVIEW_CAP = 30;

/** One draft slot per conversation (and one for the new-chat index), scoped
 * to user + org so shared machines never leak text across accounts. */
function chatDraftKey(
  userId: string | undefined,
  organizationId: string,
  threadId?: string,
) {
  const prefix =
    userId !== undefined
      ? `chat-draft-${userId}-${organizationId}`
      : `chat-draft-${organizationId}`;
  return threadId !== undefined ? `${prefix}-${threadId}` : `${prefix}-new`;
}

interface ChatSurfaceProps {
  organizationId: string;
  /** The open thread, or none on the chat index. */
  threadId?: string;
  /** Start new conversations inside this project (the project's "New chat"
   * flow) — the thread is project-linked at creation, so its agent runs
   * pre-equipped with the project's per-agent binding. */
  projectId?: string;
  /**
   * Stay on the blank composer (header / shortcut / `?projectId`). When
   * false on the index, the surface resumes the caller's most recent thread.
   */
  startFresh?: boolean;
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
  startFresh = false,
}: ChatSurfaceProps) {
  const { t } = useT('chat');
  const { t: tQuestions } = useT('questions');
  const { toast } = useToast();
  const navigate = useNavigate();
  const ability = useAbility();
  // Mirrors the settings rail's gate for the AI-providers page: whoever can
  // open that page gets pointed at it; everyone else is told to ask an admin.
  const canManageProviders = ability.can('read', 'developerSettings');

  const threads = useChatThreads(organizationId);

  // Landing on /chat without an explicit fresh intent resumes the caller's
  // most recent thread. Fresh stays for `?new=1`, project new-chat, and when
  // there is nothing to resume.
  useEffect(() => {
    if (threadId !== undefined || startFresh) return;
    if (threads.status !== 'ready') return;
    const latest = pickMostRecentThread(threads.data);
    if (latest === undefined) return;
    void navigate({
      to: '/dashboard/$id/chat/$threadId',
      params: { id: organizationId, threadId: latest.id },
      replace: true,
    });
  }, [threadId, startFresh, threads, navigate, organizationId]);

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

  // The clarifying question this conversation is waiting on, if any. Read off
  // the VIEW thread — the sibling actually on screen, same as the exports.
  const pendingQuestion = usePendingQuestion(organizationId, viewThreadId);
  const questionResolve = useResolveQuestion(organizationId);

  const [selection, setSelection] = useState(NO_SELECTION);
  const [exportOpen, setExportOpen] = useState(false);
  // Esc collapses the question panel to a one-line bar so the composer comes
  // back. Local and per-thread: the question is still pending server-side,
  // the reader just wants the input. Nothing here traps them in it.
  const [questionCollapsed, setQuestionCollapsed] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  /**
   * Questions this person has already dealt with, by request id.
   *
   * Answering or skipping is done the moment they do it — the server write
   * that closes the row is bookkeeping catching up. Deriving the panel purely
   * from the live query meant a write that failed (or merely lagged) left the
   * bar sitting above the composer offering a question already answered, with
   * the reply to it streaming directly above.
   */
  const [settledQuestions, setSettledQuestions] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    // A collapse belongs to the conversation it happened in.
    setQuestionCollapsed(false);
    setAnswerError(null);
    setSettledQuestions(new Set());
  }, [threadId]);
  // Select-to-quote: staged by the floating quote affordance on messages,
  // rendered as a chip in the composer, prepended on the next send.
  const [quotedText, setQuotedText] = useState<string | null>(null);
  useEffect(() => {
    // A staged quote belongs to the conversation it was selected in.
    setQuotedText(null);
  }, [threadId]);

  // The composer owns its draft (persisted per thread); the surface reaches
  // in for the starter fill and the failed-send restore.
  const composerRef = useRef<ComposerHandle>(null);
  const { data: currentUser } = useCurrentUser();
  const draftKey = chatDraftKey(currentUser?.userId, organizationId, threadId);

  // Client-side budget gate. The server enforces the budget authoritatively
  // (a refused turn), but without this the composer leaves Send enabled and
  // the user only learns they are over budget after the message lands as a
  // failed turn (#2345). `exceeded` is team-independent (hard blocks span
  // all teams); loading returns undefined → the gate stays open, never a
  // false block.
  const teamFilter = useOptionalTeamFilter();
  const { data: budgetStatus } = useMyBudgetStatus(
    organizationId,
    teamFilter?.selectedTeamId,
  );
  const budgetExceeded = budgetStatus?.exceeded === true;

  // The open thread answered null: deleted, foreign, or a revoked share.
  // Rendering a healthy empty conversation would invite the user to type
  // into a void — show the explicit not-found state instead.
  const threadNotFound =
    threadId !== undefined &&
    openThread.status === 'ready' &&
    openThread.data === null;

  // An archived conversation reads; it does not compose. The banner carries
  // the one action that changes that.
  const threadArchived =
    threadId !== undefined &&
    openThread.status === 'ready' &&
    openThread.data !== null &&
    openThread.data.archived;
  const [unarchiving, setUnarchiving] = useState(false);

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

  // The header's Share opens the manage-sharing dialog (the 0.3 header
  // treatment): status, link, republish, and revoke in one place. The row
  // menu keeps its one-gesture share+copy.
  const [shareOpen, setShareOpen] = useState(false);

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

  // The header menu carries the SAME thread actions as the sidebar row (the
  // 0.3 doctrine: header and sidebar never drift) — shared handlers, plus
  // the same one-bulk-read hold gating for the destructive tail.
  const { t: tCommon } = useT('common');
  const { t: tGovernance } = useT('governance');
  const projectsQuery = useChatProjects(organizationId);
  const headerProjects =
    projectsQuery.status === 'ready' ? projectsQuery.data : [];
  const holdsQuery = useThreadHolds(organizationId);
  const threadHeld =
    holdsQuery.status === 'ready' &&
    threadId !== undefined &&
    (holdsQuery.data.orgHeld || holdsQuery.data.targetIds.includes(threadId));
  const headerMenuActions = useThreadMenuActions(organizationId, {
    id: threadId ?? '',
    ...(activeThread?.pinnedAt !== undefined
      ? { pinnedAt: activeThread.pinnedAt }
      : {}),
  });
  const [deleteOpen, setDeleteOpen] = useState(false);

  /** One item list for BOTH conversation menus (desktop top bar and the
   * mobile header) — built here so the two can never drift. */
  const headerMenuItems: DropdownMenuGroup[] = [
    // Explains the disabled destructive items while a hold covers the
    // conversation (server-enforced either way).
    ...(threadHeld
      ? [
          [
            {
              type: 'label' as const,
              content: tGovernance('legalHold.badges.blockedByHold'),
            },
          ],
        ]
      : []),
    [
      // A pair cannot be shared — settle first (server-enforced; the entry
      // disappears rather than failing).
      ...(pair === null
        ? [
            {
              type: 'item' as const,
              label: t('share.button'),
              icon: Share2,
              onClick: () => setShareOpen(true),
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
    // The row menu's thread actions, one for one — shared handlers keep the
    // menus from drifting.
    ...(activeThread !== undefined
      ? [
          [
            {
              type: 'item' as const,
              label:
                activeThread.pinnedAt === undefined
                  ? t('pinChat')
                  : t('unpinChat'),
              icon: activeThread.pinnedAt === undefined ? Pin : PinOff,
              onClick: headerMenuActions.togglePin,
            },
            moveToProjectMenuItem({
              t,
              projects: headerProjects,
              currentProjectId: activeThread.projectId,
              onMove: headerMenuActions.moveToProject,
            }),
          ],
          [
            {
              type: 'item' as const,
              label: t('archive'),
              icon: Archive,
              disabled: threadHeld,
              // The archived banner takes over in place — no navigation,
              // unlike the row's action.
              onClick: () => headerMenuActions.setArchived(true),
            },
            {
              type: 'item' as const,
              label: tCommon('actions.delete'),
              icon: Trash2,
              destructive: true,
              disabled: threadHeld,
              onClick: () => setDeleteOpen(true),
            },
          ],
        ]
      : []),
  ];

  // Mobile (<md): the desktop sub-panel and floating top bar are hidden —
  // the drawer carries the thread list, the compact header the same
  // conversation menu. Closed on every navigation so picking a chat lands
  // on the conversation, not under the drawer.
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  useEffect(() => {
    setMobileThreadsOpen(false);
  }, [threadId]);

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

  // Hydrate the effort pick from the open thread once its row loads. The
  // pick LIVES on the thread. The chat layout keeps this surface mounted
  // between the index and `$threadId`, so a New-chat pick would be
  // overwritten by a row that was born without the field — first-send and
  // arena-create stamp `effortHydratedFor` before navigate so that echo
  // cannot wrestle the hand that just made it. Runs once per thread;
  // in-session picks on an already-open thread are left alone the same way.
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
    // Arena compares two NAMED models. Entering it while the composer is on
    // Auto pins column A to the first direct model — a mode cannot occupy a
    // column. Local state only: the user chose Arena, not a model, so the
    // sticky preference stays untouched (and stays Auto after settle).
    if (selection.modelSelection === 'auto') {
      const pinned = models[0];
      if (pinned === undefined) return;
      setSelection((previous) => {
        const { modelSelection: _auto, ...rest } = previous;
        return {
          ...rest,
          modelId: pinned.id,
          providerSlug: pinned.providerSlug,
        };
      });
    }
    void (async () => {
      // On the index the pair needs a conversation first — created bare,
      // so the first send fans into both columns instead of running solo.
      let target = viewThreadId;
      if (target === undefined) {
        const created = await arenaActions.createThread(
          projectId,
          selection.reasoningEffort,
        );
        if (created === null) {
          toast({ title: t('arena.startFailed'), variant: 'destructive' });
          return;
        }
        target = created;
        effortHydratedFor.current = created;
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
    setSelection((previous) => {
      // A pick the listing no longer serves (policy tightened, credential
      // removed) falls back to the default seed instead of riding into a
      // guaranteed refusal at send time.
      let current = previous;
      if (
        previous.modelId !== undefined &&
        !models.some((model) => model.id === previous.modelId)
      ) {
        const { modelId: _stale, providerSlug: _staleSlug, ...rest } = previous;
        current = rest;
      }
      return withDefaultModel(current, models, preferredId);
    });
  }, [models, preference]);

  // An explicit model pick becomes the user's sticky default; the seeding
  // effect above writes nothing, so only real choices persist. Picking Auto
  // is just as explicit: it CLEARS the stored id (absent preference = Auto),
  // so the old pin cannot resurface in the next session.
  const handleSelectionChange = (next: ComposerSelection) => {
    if (next.modelId !== undefined && next.modelId !== selection.modelId) {
      modelPreference.save(next.modelId);
    } else if (
      next.modelSelection === 'auto' &&
      selection.modelSelection !== 'auto'
    ) {
      modelPreference.save(undefined);
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

  // Files staged for the next send — pasted, dropped, or picked into the
  // composer, uploaded eagerly so the send itself is instant. The hook's
  // default allowlist IS the chat family (strictly the 0.3 set: images,
  // documents, text-based files, audio/video — plus the org upload policy
  // override), so no narrowing here. Bound to the open thread so the file
  // lifecycle follows it; a send from the index uploads before the thread
  // exists (the v1 grandfather path).
  const uploadConfig = useMemo(
    () => ({
      organizationId,
      ...(threadId !== undefined ? { threadId } : {}),
    }),
    [organizationId, threadId],
  );
  const attachmentUpload = useConvexFileUpload(uploadConfig);
  // The picker's `accept` filter mirrors 0.3's `effectiveAccept`: the org
  // upload policy's extension list when one is enforced, else the full
  // chat family. Validation happens in the upload hook either way.
  const uploadPolicy = useUploadPolicy(organizationId);
  const attachAccept = useMemo(() => {
    if (
      !uploadPolicy.policyEnabled ||
      uploadPolicy.allowedExtensions.length === 0
    ) {
      return CHAT_UPLOAD_ACCEPT;
    }
    return uploadPolicy.allowedExtensions.map((ext) => `.${ext}`).join(',');
  }, [uploadPolicy]);
  const {
    attachments: stagedAttachments,
    setAttachments: setStagedAttachments,
    clearAttachments,
    uploadFiles,
    uploadingFiles,
    removeAttachment,
    cancelUpload,
    retryAttachmentTranscription,
  } = attachmentUpload;
  const {
    statusMap: transcriptionStatuses,
    isTranscribing,
    isQueryLoading: transcriptionQueryLoading,
  } = useFileTranscriptionStatus(stagedAttachments, organizationId);
  const {
    statusMap: indexingStatuses,
    isIndexing,
    isQueryLoading: indexingQueryLoading,
  } = useFileIndexingStatus(stagedAttachments, organizationId);
  // Pasted video links: reactive job rows + ingest/cancel/retry. Their
  // transcripts join the send as attachments — completed ones bind on a
  // direct send; still-processing ones ride the deferred (send-then-wait)
  // path below.
  const videoLinks = useChatVideoLinks({
    threadId: viewThreadId,
    organizationId,
    locale,
  });
  // Anything still processing? Then Send parks the message server-side and
  // the watcher fires it when everything settles — the 0.3 send-then-wait.
  // Unknown-yet statuses defer too: parking is always safe, blocking is not.
  const attachmentsProcessing =
    isTranscribing ||
    transcriptionQueryLoading ||
    isIndexing ||
    indexingQueryLoading ||
    videoLinks.isAnyProcessing;
  // Staged images belong to the conversation they were staged in — switching
  // threads clears them; entering arena clears them too (the pair lanes
  // deliberately compare MODELS, and attachments would fork that comparison).
  useEffect(() => {
    clearAttachments();
  }, [threadId, clearAttachments]);
  const arenaLive = pair !== null;
  useEffect(() => {
    if (arenaLive) clearAttachments();
  }, [arenaLive, clearAttachments]);

  // Sent-image previews (`fileId → objectURL`): a send moves the staged
  // object URLs here instead of revoking them, so the optimistic bubble (and
  // the real row that adopts it) paints the image the instant Send is
  // pressed — the pixels are already in memory. NOT cleared on thread switch
  // (a send from the index navigates into its new thread and needs them);
  // bounded by eviction and revoked wholesale on unmount.
  const sentPreviewsRef = useRef(new Map<string, string>());
  useEffect(() => {
    const previews = sentPreviewsRef.current;
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
      previews.clear();
    };
  }, []);
  const takeStagedAttachments = () => {
    const taken = stagedAttachments;
    if (taken.length === 0) return taken;
    const previews = sentPreviewsRef.current;
    for (const attachment of taken) {
      if (attachment.previewUrl !== undefined) {
        previews.set(attachment.fileId, attachment.previewUrl);
      }
    }
    // Insertion-ordered eviction keeps the map (and its blobs) bounded.
    while (previews.size > SENT_PREVIEW_CAP) {
      const oldest = previews.keys().next().value;
      if (oldest === undefined) break;
      const url = previews.get(oldest);
      previews.delete(oldest);
      if (url !== undefined) URL.revokeObjectURL(url);
    }
    setStagedAttachments([]);
    return taken;
  };

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

  const handleUnarchive = () => {
    if (threadId === undefined || unarchiving) return;
    setUnarchiving(true);
    void threadActions
      .setArchived(threadId, false)
      .then((ok) => {
        if (!ok) {
          toast({ title: t('unarchiveFailed'), variant: 'destructive' });
        }
      })
      .finally(() => setUnarchiving(false));
  };

  // A refusal names its cause: guardrail blocks, budget stops, and access
  // denials each get their own localized title instead of a generic "Send
  // failed" wrapping the raw server sentence.
  const refusalToast = (reason: string | undefined) => {
    const { titleKey, description } = turnRefusalToastContent(reason, t);
    toast({
      title: t(titleKey),
      ...(description !== undefined ? { description } : {}),
      variant: 'destructive',
    });
  };

  // Stop asks the turn to settle with what already streamed: the flag lands
  // on the generation row, the loop reads it back on its next progress write
  // or cancel poll and aborts the in-flight model call. The click itself
  // must answer INSTANTLY — `stopPending` flips the button into its
  // acknowledged state until the generation row clears.
  const [stopPending, setStopPending] = useState(false);
  useEffect(() => {
    if (!generationInFlight) setStopPending(false);
  }, [generationInFlight]);
  useEffect(() => {
    setStopPending(false);
  }, [threadId]);
  const handleStop = () => {
    // Freeze the reveal exactly where it is — the visual stop is immediate
    // even while the server-side settle is still in flight.
    freezeActiveStream();
    if (viewThreadId === undefined) return;
    setStopPending(true);
    void chatSend.stop(viewThreadId).catch((error: unknown) => {
      console.error('[chat] could not stop the turn', error);
      setStopPending(false);
      toast({ title: t('toast.sendFailed'), variant: 'destructive' });
    });
  };

  const handleSend = (text: string, intoThreadId?: string) => {
    // A turn needs its model — a concrete pick or Auto. `sendDisabled`
    // already gates this; the guard here keeps a race from slipping through.
    // The pick is narrowed ONCE, in the exact shape the wire speaks.
    const modelPick =
      selection.modelSelection === 'auto'
        ? ({ modelSelection: 'auto' } as const)
        : selection.modelId !== undefined
          ? ({
              modelId: selection.modelId,
              ...(selection.providerSlug !== undefined
                ? { providerSlug: selection.providerSlug }
                : {}),
            } as const)
          : undefined;
    if (modelPick === undefined) return;
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
          // The composer cleared on submit; a refusal must not eat the text.
          composerRef.current?.restoreText(text);
          refusalToast(failed.reason);
        });
      return;
    }
    // A composer send continues the VIEW thread (the sibling on screen); an
    // edit passes its fresh branch explicitly.
    const target = intoThreadId ?? viewThreadId;
    // Only a composer send carries (and consumes) the staged images — an
    // edit re-sends its own words. Taken BEFORE the async hop so a double
    // Enter can't send the same batch twice; a refusal puts them back. The
    // take keeps the object-URL previews alive (in `sentPreviewsRef`) so the
    // optimistic bubble below can paint them immediately.
    const consumedAttachments =
      intoThreadId === undefined ? takeStagedAttachments() : [];
    const requestAttachments = consumedAttachments.map((attachment) => ({
      fileId: attachment.fileId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
    }));
    // The pasted video URLs leave the outgoing text — the chip (and later
    // the transcript attachment) represents the video; the model must not
    // see both the raw link and its transcript.
    const consumedVideoJobs = intoThreadId === undefined ? videoLinks.jobs : [];
    let outgoingText = text;
    for (const job of consumedVideoJobs) {
      outgoingText = outgoingText.replace(job.pastedToken, '').trim();
    }

    // Send-then-wait: while any staged medium still processes, the send
    // parks server-side and fires by itself — Send never blocks on a
    // progress bar. Failed video chips DO block upstream (sendDisabled):
    // parking past a failure would wait forever.
    if (intoThreadId === undefined && attachmentsProcessing) {
      const jobIds = consumedVideoJobs.map((job) => job.jobId);
      videoLinks.markJobsSent(jobIds);
      void (async () => {
        try {
          const { threadId: parkedThreadId } = await chatSend.defer({
            ...(target !== undefined ? { threadId: target } : {}),
            text: outgoingText,
            ...(requestAttachments.length > 0
              ? { attachments: requestAttachments }
              : {}),
            ...(jobIds.length > 0 ? { videoJobIds: jobIds } : {}),
            ...modelPick,
            ...(selection.reasoningEffort !== undefined
              ? { reasoningEffort: selection.reasoningEffort }
              : {}),
            ...(threadId === undefined && projectId !== undefined
              ? { projectId }
              : {}),
            locale,
          });
          if (threadId === undefined) {
            effortHydratedFor.current = parkedThreadId;
            void navigate({
              to: '/dashboard/$id/chat/$threadId',
              params: { id: organizationId, threadId: parkedThreadId },
            });
          }
        } catch (error) {
          console.error('[chat] could not park the send', error);
          videoLinks.unmarkJobsSent(jobIds);
          composerRef.current?.restoreText(text);
          if (consumedAttachments.length > 0) {
            setStagedAttachments(consumedAttachments);
          }
          toast({ title: t('toast.sendFailed'), variant: 'destructive' });
        }
      })();
      return;
    }
    // The optimistic rows appear NOW — before any round-trip, images
    // included. An edit's baseline is unknowable (the branch's rows are not
    // loaded yet), so it relies on the text match alone.
    const sentAt = Date.now();
    resetGlobalFreeze();
    scrollIntentRef.current = target === undefined ? true : 'smooth';
    const consumedJobIds = consumedVideoJobs.map((job) => job.jobId);
    videoLinks.markJobsSent(consumedJobIds);
    setPendingSend(
      createPendingSend({
        text: outgoingText,
        ...(requestAttachments.length > 0
          ? { attachments: requestAttachments }
          : {}),
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
          text: outgoingText,
          ...(requestAttachments.length > 0
            ? { attachments: requestAttachments }
            : {}),
          ...(consumedJobIds.length > 0 ? { bindVideoJobs: true } : {}),
          ...modelPick,
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
            // A composer send cleared the field on submit — put the text
            // (and any images / video chips it carried) back so nothing has
            // to be redone. Edit sends never touched the composer.
            if (intoThreadId === undefined) {
              composerRef.current?.restoreText(text);
              if (consumedAttachments.length > 0) {
                setStagedAttachments(consumedAttachments);
              }
              videoLinks.unmarkJobsSent(consumedJobIds);
              void chatSend.unbindVideoJobs(turn.boundVideoJobIds);
            }
            refusalToast(outcome.reason);
          },
          (error: unknown) => {
            console.error('[chat] the turn failed', error);
            if (intoThreadId === undefined) {
              composerRef.current?.restoreText(text);
              if (consumedAttachments.length > 0) {
                setStagedAttachments(consumedAttachments);
              }
              videoLinks.unmarkJobsSent(consumedJobIds);
              void chatSend.unbindVideoJobs(turn.boundVideoJobIds);
            }
            toast({ title: t('toast.sendFailed'), variant: 'destructive' });
          },
        );
        if (threadId === undefined) {
          effortHydratedFor.current = turn.threadId;
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
        if (intoThreadId === undefined) {
          composerRef.current?.restoreText(text);
          videoLinks.unmarkJobsSent(consumedJobIds);
        }
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
    if (viewThreadId === undefined) return;
    // Same pick shape as a send: Auto re-resolves per attempt, so "try
    // again" may legitimately answer from a different model.
    const modelPick =
      selection.modelSelection === 'auto'
        ? ({ modelSelection: 'auto' } as const)
        : selection.modelId !== undefined
          ? ({
              modelId: selection.modelId,
              ...(selection.providerSlug !== undefined
                ? { providerSlug: selection.providerSlug }
                : {}),
            } as const)
          : undefined;
    if (modelPick === undefined) return;
    const parentId = viewThreadId;
    const rows = threadView.items;
    const prompt = rows
      .toReversed()
      .find((row) => row.role === 'user' && row.sequence < message.sequence);
    if (!prompt) return;
    void branchActions
      .branchForRegenerate(parentId, message.id)
      .then(async (branchId) => {
        if (branchId === null) {
          toast({ title: t('regenerateFailed'), variant: 'destructive' });
          return;
        }
        rememberSelection(parentId, prompt.sequence, branchId);
        const outcome = await branchActions.regenerate(branchId, {
          ...modelPick,
          ...(selection.reasoningEffort !== undefined
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
        });
        if (outcome.refused) {
          const { titleKey, description } = turnNamedFailureToastContent(
            outcome.reason,
            'regenerateFailed',
            t,
          );
          toast({
            title: t(titleKey),
            ...(description !== undefined ? { description } : {}),
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
  /**
   * Retire a pending question because the person said something else.
   *
   * Same trampoline as the row handlers: assigned per render below, once
   * `activeQuestion` exists, so the send handler stays stable.
   */
  const supersedeQuestionRef = useRef<() => void>(() => {});

  const stableSend = useCallback((text: string) => {
    // Talking past a question retires it. Answering is not the only way to
    // move on, and without this the collapsed bar would sit there forever
    // offering a question the conversation had already left behind.
    supersedeQuestionRef.current();
    rowHandlersRef.current.send(text);
  }, []);

  const pendingRow =
    pendingQuestion.status === 'ready' ? pendingQuestion.data : null;
  // A question the person has settled is gone from their side immediately,
  // whether or not the write closing its row has landed yet.
  const activeQuestion =
    pendingRow && !settledQuestions.has(pendingRow.requestId)
      ? pendingRow
      : null;

  const markSettled = useCallback((requestId: string): void => {
    setSettledQuestions((current) => new Set(current).add(requestId));
  }, []);

  /** Answering: close the row, then send the answers as the person's own
   *  next message. The row closes FIRST so the live watch clears the panel
   *  rather than leaving the question up while the reply streams under it. */
  const handleAnswerQuestion = useCallback(
    async (answers: readonly QuestionAnswer[]): Promise<void> => {
      if (!activeQuestion) return;
      setAnswerBusy(true);
      setAnswerError(null);
      // Settled from this point: the panel and its collapsed bar are gone
      // before the round trip, so the answer never sits above its own reply.
      markSettled(activeQuestion.requestId);
      try {
        const text = formatAnswerSetForModel(activeQuestion.set, answers);
        // The answers ride the message, not the row: the row is a marker.
        // Closing the row is BOOKKEEPING; sending is the conversation. This
        // used to be awaited ahead of the send, so a failed write threw and
        // the send never ran — four answers the person had just given, gone,
        // under a message telling them to try again. It is best-effort now,
        // exactly like the supersede path, and the send happens either way.
        //
        await questionResolve
          .resolve(activeQuestion.requestId, 'answered')
          .catch((error: unknown) => {
            // The row stays pending server-side; `markSettled` already took
            // it off this screen, so the failure costs a stale row and
            // nothing the person can see.
            console.warn('[chat] recording the answer failed:', error);
          });
        rowHandlersRef.current.send(text);
      } catch (error) {
        // Only the send can reach this now, which is what the message says.
        console.warn('[chat] sending the answers failed:', error);
        setAnswerError(tQuestions('errorSubmitFailed'));
      } finally {
        setAnswerBusy(false);
      }
    },
    [activeQuestion, markSettled, questionResolve, tQuestions],
  );

  /**
   * Skip: give up on the question outright. The same retirement a typed
   * message performs, just asked for directly — so the transcript records it
   * as skipped and the composer comes straight back.
   */
  const handleSkipQuestion = useCallback((): void => {
    supersedeQuestionRef.current();
    composerRef.current?.focus();
  }, []);

  /**
   * A typed message retires whatever question was outstanding.
   *
   * There used to be a "Type instead" button for this, but `Other…` already
   * covers answering in your own words on every question — it is injected by
   * the client, so it is always there — which left the button meaning only
   * "abandon the whole set". Sending a message says that on its own.
   *
   * This is now the ONLY path that supersedes, so a person who collapses the
   * panel and talks past it depends on it: without it the question stays
   * pending and the bar offering it never goes away.
   *
   * Fire-and-forget on purpose — the message must go on the keystroke, not
   * after a round-trip, and a lost supersede costs one stale pending row.
   */
  supersedeQuestionRef.current = (): void => {
    if (!activeQuestion) return;
    markSettled(activeQuestion.requestId);
    void questionResolve
      .resolve(activeQuestion.requestId, 'superseded')
      .catch((error: unknown) => {
        console.warn('[chat] superseding the question failed:', error);
      });
  };
  // Same trampoline treatment for the attach handlers: `uploadFiles` gets a
  // fresh identity whenever the upload config re-derives, and the memo'd
  // composer must not re-render on every surface pass because of it.
  const attachHandlersRef = useRef({
    uploadFiles,
    removeAttachment,
    cancelUpload,
  });
  attachHandlersRef.current = { uploadFiles, removeAttachment, cancelUpload };
  const stableAttachFiles = useCallback((files: File[]) => {
    void attachHandlersRef.current.uploadFiles(files);
  }, []);
  const stableRemoveAttachment = useCallback(
    (fileId: string) => attachHandlersRef.current.removeAttachment(fileId),
    [],
  );
  const stableCancelUpload = useCallback(
    (fileId: string) => attachHandlersRef.current.cancelUpload(fileId),
    [],
  );
  const stableRetryTranscription = useCallback(
    (fileId: string) => {
      retryAttachmentTranscription(fileId);
    },
    [retryAttachmentTranscription],
  );
  // Video-link handlers ride the same trampoline: the hook's callbacks
  // re-derive with the thread subscription, the memo'd composer must not.
  const videoHandlersRef = useRef(videoLinks);
  videoHandlersRef.current = videoLinks;
  const stableCancelVideoJob = useCallback(
    (jobId: VideoLinkJob['jobId']) =>
      void videoHandlersRef.current.cancelJob(jobId),
    [],
  );
  const stableRetryVideoJob = useCallback(
    (jobId: VideoLinkJob['jobId']) =>
      void videoHandlersRef.current.retryJob(jobId),
    [],
  );
  const stableIngestVideoUrls = useCallback(
    (text: string) => void videoHandlersRef.current.ingestUrlsFromText(text),
    [],
  );
  // A starter FILLS the composer for tailoring before send — the 0.3
  // treatment — instead of firing the text as an un-editable first message.
  const handleStarterClick = useCallback((starter: string) => {
    composerRef.current?.fillText(starter);
  }, []);
  // A cancelled parked send puts its text back — only into an EMPTY field,
  // so it never clobbers what the user typed since.
  const stableRestoreText = useCallback((restored: string) => {
    composerRef.current?.restoreText(restored);
  }, []);
  const stableStop = useCallback(() => rowHandlersRef.current.stop(), []);
  const stableVoiceOutputChange = useCallback(
    (next: boolean) => rowHandlersRef.current.voiceOutputChange(next),
    [],
  );

  return (
    // The preview map's identity never changes — the provider re-renders
    // nothing; rows read the map during their own renders.
    <AttachmentPreviewProvider value={sentPreviewsRef.current}>
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
          {/* Mobile header (<md): the sub-panel and the floating bar above are
            desktop-only — without this row a phone could neither switch
            threads nor reach the conversation actions. */}
          <div className="border-border flex h-12 shrink-0 items-center border-b px-2 md:hidden">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setMobileThreadsOpen(true)}
              // Named after the drawer it opens, not the desktop panel toggle
              // — a screen reader (and a test locator) must tell them apart.
              aria-label={t('chatsSection')}
            >
              <PanelLeftOpen className="text-muted-foreground size-5" />
            </Button>
            <div className="min-w-0 flex-1 px-2">
              {activeThread?.title !== undefined && (
                <Text variant="muted" className="truncate text-center text-sm">
                  {activeThread.title}
                </Text>
              )}
            </div>
            {threadId !== undefined && !threadNotFound ? (
              <DropdownMenu
                align="end"
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('aria.threadActions')}
                  >
                    <Ellipsis className="text-muted-foreground size-5" />
                  </Button>
                }
                items={headerMenuItems}
              />
            ) : (
              // Keep the title centered when the menu has no seat.
              <div aria-hidden className="size-9" />
            )}
          </div>
          <Sheet
            open={mobileThreadsOpen}
            onOpenChange={setMobileThreadsOpen}
            title={t('chatsSection')}
            side="left"
            className="w-72 p-0"
          >
            {/* Any row link closes the drawer — the threadId effect below only
              fires on a CHANGED thread, and re-picking the open one must not
              leave the drawer covering it. */}
            <div
              className="flex h-full min-h-0 flex-col overflow-hidden pt-8"
              onClickCapture={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest('a') !== null
                ) {
                  setMobileThreadsOpen(false);
                }
              }}
            >
              <ThreadList
                organizationId={organizationId}
                threads={threadsAvailable ? threads.data : NO_THREADS}
                activeThreadId={threadId}
                available={threadsAvailable}
              />
            </div>
          </Sheet>

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
              {threadId !== undefined && !threadNotFound && (
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
                    items={headerMenuItems}
                  />
                </div>
              )}
            </div>
          </div>
          {threadNotFound ? (
            // Deleted, foreign, or revoked-share thread: an explicit dead end
            // with a way out — never a healthy-looking empty conversation the
            // user types into only to be refused after the fact.
            <EmptyState
              icon={MessageSquareOff}
              title={t('notFound')}
              headingLevel={2}
              className="min-h-0 flex-1"
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigate({
                      to: '/dashboard/$id/chat',
                      params: { id: organizationId },
                      search: { new: true },
                    })
                  }
                >
                  {t('newChat')}
                </Button>
              }
            />
          ) : pair !== null && viewThreadId !== undefined ? (
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
              <ChatMessagesErrorBoundary
                organizationId={organizationId}
                threadId={viewThreadId}
              >
                <ChatTranscript
                  organizationId={organizationId}
                  threadId={viewerIsOwner ? viewThreadId : undefined}
                  threadRootId={threadId}
                  pendingSend={pendingSend}
                  isGenerating={generationInFlight || pendingSend !== null}
                  scrollIntentRef={scrollIntentRef}
                  feedback={viewerIsOwner ? feedbackByMessage : undefined}
                  forkGroups={viewerIsOwner ? forkGroups : undefined}
                  // An archived conversation reads; every mutating affordance
                  // waits for the banner's Unarchive.
                  onEditSubmit={
                    viewerIsOwner && !threadArchived
                      ? handleEditSubmit
                      : undefined
                  }
                  // Regenerating picks the composer's current DIRECT model — a
                  // sandbox thread's turns run elsewhere, so it has no re-run here.
                  onRegenerate={
                    viewerIsOwner &&
                    !threadArchived &&
                    activeThread?.kind !== 'sandbox'
                      ? handleRegenerate
                      : undefined
                  }
                  onFork={
                    viewerIsOwner && !threadArchived ? handleFork : undefined
                  }
                  voiceEnabled={voiceEnabled && viewerIsOwner}
                  speakAvailable={speakAvailable}
                  // Clears the floating top bar at rest.
                  className={viewerIsOwner ? 'md:pt-13' : undefined}
                />
              </ChatMessagesErrorBoundary>
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
            // welcome — a heading and four starters. A starter fills the
            // composer for tailoring (the 0.3 behavior); Enter then sends it.
            // It also holds while the model listing is still answering, so the
            // surface never flips welcome → provider-setup → welcome across
            // navigations.
            <WelcomeView onSuggestionClick={handleStarterClick} />
          )}

          {!threadNotFound &&
            (threadArchived ? (
              <ArchivedBanner
                isUnarchiving={unarchiving}
                onUnarchive={handleUnarchive}
              />
            ) : activeQuestion !== null && !questionCollapsed ? (
              /* The question takes the INPUT AREA, not a card in the scroll.
                   The whole complaint about the shape this replaces was that
                   the form sat in the transcript, so the reader had to scroll
                   back to find it. This is one more branch of the conditional
                   that already swaps the composer out for the archived banner
                   — and the panel is never modal and never traps focus. */
              <div className="shrink-0 px-4 pb-4">
                <QuestionFlow
                  set={activeQuestion.set}
                  onSubmit={handleAnswerQuestion}
                  onSkip={handleSkipQuestion}
                  onCollapse={() => setQuestionCollapsed(true)}
                  busy={answerBusy}
                  error={answerError}
                />
                <DataNoticeFooter
                  organizationId={organizationId}
                  className="pt-1 pb-1"
                />
              </div>
            ) : (
              <div className="shrink-0 px-4 pb-4">
                <BudgetBanner organizationId={organizationId} />
                {/* Collapsed but still outstanding: one line above a fully
                      usable composer. Typing is never blocked — this is the
                      way back in, not a gate. */}
                {activeQuestion !== null && (
                  <button
                    type="button"
                    onClick={() => setQuestionCollapsed(false)}
                    className="border-border bg-muted/40 hover:bg-muted focus-visible:ring-ring mb-1.5 flex min-h-9 w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <MessageCircleQuestion
                      className="text-primary size-4 shrink-0"
                      aria-hidden
                    />
                    <Text as="span" className="text-sm">
                      {activeQuestion.set.questions.length > 1
                        ? tQuestions('collapsedMany', {
                            count: activeQuestion.set.questions.length,
                          })
                        : tQuestions('collapsedOne')}
                    </Text>
                  </button>
                )}
                {/* Sends parked while their attachments still process —
                    the watcher fires each one when it is ready. */}
                {viewThreadId !== undefined && (
                  <DeferredSendTray
                    organizationId={organizationId}
                    threadId={viewThreadId}
                    onRestoreText={stableRestoreText}
                  />
                )}
                <Composer
                  ref={composerRef}
                  draftKey={draftKey}
                  models={models}
                  selection={selection}
                  onSelectionChange={stableSelectionChange}
                  onSend={stableSend}
                  onStop={stableStop}
                  generating={generationInFlight}
                  stopPending={stopPending}
                  disabled={composerDisabled}
                  // Send waits for its prerequisites: a model, the running
                  // turn to settle, and the reads a correct send needs (the
                  // thread list and the open thread's messages). Typing and
                  // the picker stay usable throughout. In arena the surface
                  // deliberately SKIPS its own thread view (the columns each
                  // own one), so that read can never become available — the
                  // columns' liveness gates (arenaBusyB / generationInFlight)
                  // stand in for it.
                  // Processing media no longer holds Send — a send during
                  // transcription/indexing/video ingest parks server-side
                  // and fires on readiness. Only a FAILED video chip still
                  // blocks: parking past it would wait forever, so the
                  // user retries or removes it first.
                  sendDisabled={
                    (selection.modelId === undefined &&
                      selection.modelSelection !== 'auto') ||
                    generationInFlight ||
                    arenaBusyB ||
                    !threadsAvailable ||
                    videoLinks.hasFailedJobs ||
                    (threadId !== undefined &&
                      !arenaActive &&
                      !messagesAvailable)
                  }
                  // Over budget wins over a failed chip — the period cap
                  // is the harder stop.
                  {...(budgetExceeded
                    ? { sendBlockedReason: t('budgetExceededDefault') }
                    : videoLinks.hasFailedJobs
                      ? {
                          sendBlockedReason: t(
                            'videoLink.chip.failedSendBlockedTooltip',
                          ),
                        }
                      : {})}
                  quotedText={quotedText}
                  onQuotedTextChange={setQuotedText}
                  // Attachments: hidden during a live arena pair — the
                  // lanes compare models on identical input, and the staged
                  // set was cleared when the pair went live.
                  {...(pair === null
                    ? {
                        attachments: stagedAttachments,
                        uploadingAttachments: uploadingFiles,
                        onAttachFiles: stableAttachFiles,
                        onRemoveAttachment: stableRemoveAttachment,
                        onCancelAttachmentUpload: stableCancelUpload,
                        attachAccept,
                        transcriptionStatuses,
                        onRetryTranscription: stableRetryTranscription,
                        indexingStatuses,
                        videoLinkJobs: videoLinks.jobs,
                        onCancelVideoJob: stableCancelVideoJob,
                        onRetryVideoJob: stableRetryVideoJob,
                        onIngestVideoUrls: stableIngestVideoUrls,
                      }
                    : {})}
                  voiceOutput={voiceEnabled}
                  onVoiceOutputChange={stableVoiceOutputChange}
                  voiceOutputHidden={voiceVetoed}
                  voiceOutputAvailable={voiceCapabilities.hasTts}
                  // Dictation's Firefox fallback: the mic only renders when
                  // a transcription model can actually answer (same catalog
                  // walk as the TTS flag above).
                  organizationId={organizationId}
                  transcriptionAvailable={voiceCapabilities.hasTranscription}
                  {...(arenaAvailable || pair !== null
                    ? {
                        arenaActive: pair !== null,
                        onArenaChange: handleArenaChange,
                      }
                    : {})}
                />
                {/* The confidentiality disclosure sits with the field it
                    governs — visible BEFORE the first send, not only under a
                    settled reply (gematik: the notice is pre-input). */}
                <DataNoticeFooter
                  organizationId={organizationId}
                  className="pt-1 pb-1"
                />
              </div>
            ))}
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

        {/* The header menu's Share — status, link, republish, revoke. */}
        {threadId !== undefined && (
          <ShareChatDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            organizationId={organizationId}
            threadId={threadId}
          />
        )}

        {/* The header menu's Delete — same dialog as the row menu's. */}
        {deleteOpen && activeThread !== undefined && (
          <ThreadDeleteDialog
            thread={activeThread}
            organizationId={organizationId}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() =>
              void navigate({
                to: '/dashboard/$id/chat',
                params: { id: organizationId },
              })
            }
          />
        )}

        {/* Select text in a reply → floating Quote → chip over the composer.
          Mounted only where quoting can land somewhere (the composer). */}
        {!threadNotFound && !threadArchived && viewerIsOwner && (
          <SelectionQuoteButton onQuote={setQuotedText} />
        )}

        {/* One polite live region narrating voice playback transitions. */}
        <VoiceOutputAnnouncer />
      </div>
    </AttachmentPreviewProvider>
  );
}
