'use client';

/**
 * The chat screen: the conversation under its header, the composer, and
 * the Canvas. The Home panel beside it lives in the dashboard shell.
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
import { cn } from '@tale/ui/cn';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { SkipLink } from '@tale/ui/skip-link';
import { Text } from '@tale/ui/text';
import { ThreadHeader, ThreadHeaderSeparator } from '@tale/ui/thread-header';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import { useToast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  Cpu,
  Download,
  Ellipsis,
  ListChecks,
  MessageCircle,
  MessageSquareOff,
  Pin,
  PinOff,
  PlugZap,
  Share2,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { HomeBackButton } from '@/app/features/home/components/home-back-button';
import { HomePanelToggle } from '@/app/features/home/components/home-panel-toggle';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { useMyBudgetStatus } from '@/app/features/settings/governance/hooks/queries';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useFileUpload } from '@/app/features/shared/files/use-file-upload';
import {
  freezeActiveStream,
  resetGlobalFreeze,
} from '@/app/features/shared/markdown/use-stream-buffer';
import { useAbility } from '@/app/hooks/use-ability';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import { useDocumentTitle } from '@/app/hooks/use-document-title';
import { backendRefusalDetail } from '@/app/lib/backend/adapters';
import { BackendApiError } from '@/app/lib/backend/api-client';
import { useT } from '@/lib/i18n/client';
import type { ArenaVerdict } from '@/lib/shared/arena';
import {
  forkGroupsForPath,
  forkKey,
  parseBranchSelections,
  resolveViewPath,
  selectionChainFor,
} from '@/lib/shared/branch-selection';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
import { documentTitle } from '@/lib/utils/seo';

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
  useVoiceMode,
  type ChatTurnAttachment,
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
import { chatDraftKey } from '../lib/draft-key';
import type {
  ChatMessageView,
  ComposerModelOption,
  ComposerSelection,
} from '../types';
import { isBudgetRefusalCode } from '../utils/classify-refusal';
import { pickMostRecentThread } from '../utils/most-recent-thread';
import {
  baselineSequenceOf,
  createPendingSend,
  type PendingSend,
} from '../utils/pending-messages';
import { primeAudio } from '../utils/prime-audio';
import { transcriptionNeedsRetry } from '../utils/transcription-availability';
import {
  regenerateFailureToastContent,
  turnRefusalToastContent,
} from '../utils/turn-error-toast';
import { ArchivedBanner } from './archived-banner';
import type { ArenaRound } from './arena/arena-column';
import { ArenaSplitView } from './arena/arena-split-view';
import { BudgetBanner } from './budget-banner';
import { ChatMessagesErrorBoundary } from './chat-messages-error-boundary';
import { ChatTaskTray } from './chat-task-tray';
import { ChatTranscript } from './chat-transcript';
import { Composer, type ComposerHandle } from './composer';
import { directServedModels, withDefaultModel } from './composer-model-picker';
import { ConversationSkeleton } from './conversation-skeleton';
import { CreateTaskFromChat } from './create-task-from-chat';
import { DeferredSendTray } from './deferred-send-tray';
import { ExportChatDialog } from './export-chat-dialog';
import type { MessageForkGroupView } from './message-item';
import { SelectionQuoteButton } from './selection-quote-button';
import { ShareChatDialog } from './share-chat-dialog';
import { ThreadDeleteDialog } from './thread-delete-dialog';
import { TranscriptionAvailabilityNotice } from './transcription-availability-notice';
import { VoiceOutputAnnouncer } from './voice-output-announcer';
import { WelcomeView } from './welcome-view';

const NO_SELECTION: ComposerSelection = {};

const NO_MODELS: readonly ComposerModelOption[] = [];
const NO_PROVIDERS: readonly string[] = [];
/** The message field's DOM id — the chat skip link's target. */
const COMPOSER_TEXTAREA_ID = 'chat-composer';

/** How many sent-image previews stay alive for instant rendering before the
 * oldest are revoked — a compressed image is ≤1 MB, so this bounds the held
 * blobs to a few dozen MB in the worst case. */
const SENT_PREVIEW_CAP = 30;

/** The fork an edit / regenerate send goes into: the fork point (as the
 * server resolved it — the thread whose turn the sibling versions) and the
 * fresh sibling — enough to undo the fork when the turn never lands. */
interface BranchFork {
  readonly parentId: string;
  readonly forkSequence: number;
  readonly branchId: string;
  /** The sibling the fork point showed BEFORE the fork — where the view
   * returns when the turn never lands (the parent's own tail when nothing
   * was chosen there). */
  readonly restoreTo: string;
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
  const selections = useMemo(() => {
    const merged: Record<string, string> = {
      ...parseBranchSelections(
        branchData.status === 'ready' ? branchData.data.selections : null,
      ),
    };
    const listed = new Set(branches.map((branch) => branch.id));
    for (const [key, chosen] of Object.entries(selectionOverrides)) {
      // An override naming a sibling the branches read has not delivered
      // yet (the fresh fork of an edit / retry) waits: the stored choice
      // keeps the view where it is until the row arrives, instead of a hop
      // to the fork point's own tail in between. A fork point's own id is
      // always known.
      if (listed.has(chosen) || key.startsWith(`${chosen}:`)) {
        merged[key] = chosen;
      }
    }
    return merged;
  }, [branchData, branches, selectionOverrides]);
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
  // The arena twin of the overlay: the prompt fanned into both columns, from
  // Send until the pair's turn resolves. Each column makes it its own
  // optimistic send and snaps it to the top (see ArenaColumn).
  const [arenaRound, setArenaRound] = useState<
    (ArenaRound & { readonly threadId: string }) | null
  >(null);
  // Arena pair first: while a pair is live the columns own their thread
  // views, and the surface's own view (below) steps aside entirely.
  const arenaPair = useArenaPair(organizationId, viewThreadId);
  const pair = arenaPair.status === 'ready' ? arenaPair.data : null;
  const arenaActive = pair !== null;
  // In arena mode the columns own their thread views — the surface skips
  // its own so a streamed token in either column never re-renders it.
  // Row/adoption facts ONLY — the per-chunk stream text is subscribed by
  // the transcript boundary below, so a streaming turn never re-renders the
  // surface (composer, header, canvas).
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
  // A new chat starts in the message box for a pointer user: nothing else on
  // the screen wants the focus, and the alternative was ~290 Tabs through the
  // sidebar (2026-09-26 evaluation, G-11). A coarse pointer keeps the
  // on-screen keyboard down until the user taps the box.
  useEffect(() => {
    if (threadId !== undefined) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    composerRef.current?.focus();
  }, [threadId]);
  const { data: currentUser } = useCurrentUser();
  const draftKey = chatDraftKey(currentUser?.userId, organizationId, threadId);

  // Client-side budget gate. The server enforces the budget authoritatively
  // (a refused turn), but without this the composer leaves Send enabled and
  // the user only learns they are over budget after the message lands as a
  // failed turn (#2345). `exceeded` is what the gate would refuse right now
  // over every cap that binds the member; loading returns undefined → the
  // gate stays open, never a false block.
  const { data: budgetStatus } = useMyBudgetStatus(organizationId);
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
  const [transcriptionFailure, setTranscriptionFailure] = useState<
    string | null
  >(null);
  const transcriptionScopeRef = useRef({ organizationId, viewThreadId });
  transcriptionScopeRef.current = { organizationId, viewThreadId };
  const handleTranscriptionUnavailable = useCallback(
    (reason?: string) => {
      // Uploads and recordings may settle after navigation. Only the surface
      // that started the operation may offer its recovery/settings action.
      if (
        transcriptionScopeRef.current.organizationId !== organizationId ||
        transcriptionScopeRef.current.viewThreadId !== viewThreadId
      )
        return;
      setTranscriptionFailure(reason ?? 'NO_TRANSCRIPTION_MODEL');
    },
    [organizationId, viewThreadId],
  );
  useEffect(() => {
    setTranscriptionFailure(null);
  }, [organizationId, viewThreadId]);
  const transcriptionSetupAction = useMemo(() => {
    const reason = transcriptionFailure;
    if (reason === null || transcriptionNeedsRetry(reason)) return undefined;
    const needsProvider = reason === 'NO_TRANSCRIPTION_MODEL';
    if (
      needsProvider ? !canManageProviders : !ability.can('write', 'orgSettings')
    )
      return undefined;
    return {
      label: t(
        needsProvider
          ? 'transcription.configureProviders'
          : 'transcription.configureModel',
      ),
      onClick: () => {
        void navigate({
          to: needsProvider
            ? '/dashboard/$id/settings/providers'
            : '/dashboard/$id/settings/governance/content-models',
          params: { id: organizationId },
        });
      },
    };
  }, [
    transcriptionFailure,
    canManageProviders,
    ability,
    t,
    navigate,
    organizationId,
  ]);
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
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  // The Home panel (chats, tasks and the inbox in one list) sits beside the
  // conversation; the shell owns it, this column only toggles it.

  // Keep the pre-hydration `boot-chat` marker (set by the inline script in
  // index.html) an honest live mirror of "a chat surface is on screen": it
  // gates the composer stand-in of every chat placeholder (boot shell,
  // access-resolving layout), so a placeholder rendered after an org switch
  // reflects the current page, not the page-load snapshot. Removed on
  // unmount — non-chat surfaces render none. (The Home panel mirrors its own
  // open state the same way.)
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('boot-chat');
    return () => {
      root.classList.remove('boot-chat');
    };
  }, []);

  // Only models a direct turn can call: a subscription credential is bound
  // to a vendor harness, and the chat page runs no sandbox.
  const models = useMemo(
    () =>
      composerOptions.status === 'ready'
        ? directServedModels(composerOptions.data.models)
        : NO_MODELS,
    [composerOptions],
  );
  // The providers whose models are left out for that reason, named in the
  // picker so a short or empty list explains itself.
  const subscriptionProviders = useMemo(() => {
    if (composerOptions.status !== 'ready') return NO_PROVIDERS;
    const offered = new Set(models);
    const hidden = composerOptions.data.models.filter(
      (model) => !offered.has(model),
    );
    if (hidden.length === 0) return NO_PROVIDERS;
    return [
      ...new Set(
        hidden.map((model) => model.providerLabel ?? model.providerSlug),
      ),
    ];
  }, [composerOptions, models]);

  // The thread being viewed, once the list has answered.
  const activeThread =
    threadId !== undefined && threads.status === 'ready'
      ? threads.data.find((thread) => thread.id === threadId)
      : undefined;
  // What the header names: the list's row, or — for a chat the list does not
  // hold (an archived one, or a teammate's shared into a project) — the
  // thread's own read. The owner's row actions still key off `activeThread`.
  const headerThread =
    activeThread ??
    (openThread.status === 'ready' && openThread.data !== null
      ? openThread.data
      : undefined);

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

  // The hand-over to a project agent: chat answers, a task produces the
  // file. A pair settles first, as for Share.
  const canCreateTask = pair === null && threadId !== undefined;
  /** One item list for BOTH conversation menus (desktop top bar and the
   * mobile header) — built here so the two can never drift. The desktop
   * header carries "Create task" as its own verb instead, so its menu
   * leaves that one entry out. */
  const conversationMenuItems = (
    withCreateTask: boolean,
  ): DropdownMenuGroup[] => [
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
      // A pair cannot be shared — settle first — and a link is the owner's to
      // publish, never a project reader's (both server-enforced; the entry
      // disappears rather than failing).
      ...(pair === null && viewerIsOwner
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
      ...(withCreateTask && canCreateTask
        ? [
            {
              type: 'item' as const,
              label: t('createTask.button'),
              icon: ListChecks,
              onClick: () => setCreateTaskOpen(true),
            },
          ]
        : []),
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
  const headerMenuItems = conversationMenuItems(true);
  const desktopMenuItems = conversationMenuItems(false);

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
  // The round in flight, while it belongs to the pair on screen.
  const openArenaRound =
    arenaRound !== null && arenaRound.threadId === viewThreadId
      ? arenaRound
      : undefined;

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
          result.refused === 'busy'
            ? 'arena.busy'
            : result.refused === 'one_sided'
              ? 'arena.oneSided'
              : 'arena.verdictError',
        ),
        variant: 'destructive',
      });
      return;
    }
    if (verdict !== undefined) toast({ title: t('arena.verdictRecorded') });
    // The surviving A is already on screen; only a winning B navigates — and
    // the composer follows it to Model B, so the next message goes to the
    // model the user just judged better, not to A's (2026-09-26 evaluation,
    // A-06). Session-only, like the Auto pin on entering Arena: the sticky
    // preference stays what the user last picked by hand.
    if (result.continueThreadId !== viewThreadId) {
      const modelB = verdict === 'b_better' ? arenaModelBChoice : undefined;
      if (modelB !== undefined) {
        setSelection((previous) => {
          const { modelSelection: _auto, providerSlug: _a, ...rest } = previous;
          return {
            ...rest,
            modelId: modelB.id,
            ...(modelB.providerSlug !== undefined
              ? { providerSlug: modelB.providerSlug }
              : {}),
          };
        });
      }
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
    const preferred =
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
      return withDefaultModel(current, models, preferred);
    });
  }, [models, preference]);

  // An explicit model pick — the id AND the provider serving it, so two
  // providers listing one id stay tellable apart — becomes the user's sticky
  // default; the seeding effect above writes nothing, so only real choices
  // persist. Picking Auto is just as explicit: it CLEARS the stored pick
  // (absent preference = Auto), so the old pin cannot resurface in the next
  // session.
  const handleSelectionChange = (next: ComposerSelection) => {
    if (
      next.modelId !== undefined &&
      (next.modelId !== selection.modelId ||
        next.providerSlug !== selection.providerSlug)
    ) {
      modelPreference.save({
        modelId: next.modelId,
        ...(next.providerSlug !== undefined
          ? { providerSlug: next.providerSlug }
          : {}),
      });
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
      transcriptionAvailable: voiceCapabilities.hasTranscription,
      transcriptionUnavailableReason:
        voiceCapabilities.transcriptionUnavailableReason,
      onTranscriptionUnavailable: handleTranscriptionUnavailable,
      ...(threadId !== undefined ? { threadId } : {}),
    }),
    [
      organizationId,
      threadId,
      voiceCapabilities.hasTranscription,
      voiceCapabilities.transcriptionUnavailableReason,
      handleTranscriptionUnavailable,
    ],
  );
  const attachmentUpload = useFileUpload(uploadConfig);
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
  // failed" wrapping the raw server sentence — by the refusal's code when
  // the server names one.
  const refusalToast = (reason: string | undefined, code?: string) => {
    const { titleKey, description } = turnRefusalToastContent(reason, t, code);
    toast({
      title: t(titleKey),
      ...(description !== undefined ? { description } : {}),
      variant: 'destructive',
    });
  };

  // A send request the door refused outright — a body it would not take, a
  // thread it cannot find, a full tray of parked sends, an archived project
  // refusing a new chat — says why in its own words: they are the
  // platform's, not a provider's, so they are shown as they are. A fault (a
  // 5xx, a network failure) says nothing beyond the title.
  const sendFailedToast = (error: unknown) => {
    const detail = backendRefusalDetail(error);
    toast({
      title: t('toast.sendFailed'),
      ...(detail !== undefined ? { description: detail } : {}),
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

  /** Flip a fork point locally and persist the choice in the background. */
  const rememberSelection = (
    parentId: string,
    sequence: number,
    chosen: string,
  ) => {
    if (threadId === undefined) return;
    const key = forkKey(parentId, sequence);
    setSelectionOverrides((previous) => ({ ...previous, [key]: chosen }));
    branchActions.select(threadId, [
      { forkKey: key, selectedThreadId: chosen },
    ]);
  };

  /**
   * A send into a fresh edit / regenerate sibling names the fork it came
   * from, so a refusal that wrote nothing can undo the fork: the selection
   * flips back to the sibling it showed before and the empty sibling is
   * dropped. Left in place, the persisted selection would follow it to a
   * prefix-only branch whose fork row does not exist — no ‹n/m› control, no
   * way back.
   */
  const abandonBranch = (fork: BranchFork) => {
    rememberSelection(fork.parentId, fork.forkSequence, fork.restoreTo);
    void branchActions.discard(fork.branchId);
  };

  const handleSend = (
    text: string,
    intoThreadId?: string,
    fork?: BranchFork,
    originalAttachments: readonly ChatTurnAttachment[] = [],
  ) => {
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
      const sentAt = Date.now();
      setArenaRound({ text, sentAt, threadId: viewThreadId });
      void arenaActions
        .startTurn({
          threadId: viewThreadId,
          partnerThreadId:
            pair.threadIdA === viewThreadId ? pair.threadIdB : pair.threadIdA,
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
          // Both sides settled: the real rows (or the refusal) replace the
          // overlay in each column.
          setArenaRound((previous) =>
            previous !== null && previous.sentAt === sentAt ? null : previous,
          );
          const failed = [a, b].find((side) => side.status === 'refused');
          if (failed === undefined) return;
          // The composer cleared on submit; a refusal that wrote nothing
          // must not eat the text. A refusal already on the record (the
          // side's transcript shows the prompt and a blocked reply) keeps
          // the composer clear — restoring would invite a duplicate send.
          if (failed.persisted !== true) {
            composerRef.current?.restoreText(text);
          }
          refusalToast(failed.reason, failed.code);
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
    const requestAttachments =
      intoThreadId !== undefined
        ? originalAttachments
        : consumedAttachments.map((attachment) => ({
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
          // A reached cap refuses the park itself: name it as a refused send
          // would be named, not as a bare "Send failed". Any other refusal
          // (a full tray, too many attachments, a thread it cannot find)
          // says why in the door's own words; a fault says nothing.
          if (
            error instanceof BackendApiError &&
            isBudgetRefusalCode(error.code)
          ) {
            refusalToast(error.message, error.code);
          } else {
            sendFailedToast(error);
          }
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
          locale,
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
            // Drop the overlay so the thinking shell does not linger on a
            // turn that will never answer: a refusal on the record replaces
            // it with the persisted rows, an early one wrote no rows at all.
            setPendingSend((previous) =>
              previous !== null && previous.sentAt === sentAt ? null : previous,
            );
            // A composer send cleared the field on submit. When the refusal
            // wrote nothing, put the text (and any images / video chips it
            // carried) back so nothing has to be redone. When it is already
            // on the record — the thread shows the message and a blocked
            // reply, the attachments and video jobs are bound to it — the
            // composer stays clear: restoring would duplicate the message
            // on the next Send. Edit sends never touched the composer.
            if (intoThreadId === undefined && outcome.persisted !== true) {
              composerRef.current?.restoreText(text);
              if (consumedAttachments.length > 0) {
                setStagedAttachments(consumedAttachments);
              }
              videoLinks.unmarkJobsSent(consumedJobIds);
              void chatSend.unbindVideoJobs(turn.boundVideoJobIds);
            }
            // An edit send that wrote nothing leaves its fresh sibling
            // empty: undo the fork so the view returns to the original tail.
            if (fork !== undefined && outcome.persisted !== true) {
              abandonBranch(fork);
            }
            refusalToast(outcome.reason, outcome.code);
          },
          (error: unknown) => {
            console.error('[chat] the turn failed', error);
            // A turn that never settled writes no rows for the overlay to be
            // adopted by, so drop it here too — otherwise the optimistic
            // bubble and its thinking shell sit there forever and the thread
            // reads as generating until a reload.
            setPendingSend((previous) =>
              previous !== null && previous.sentAt === sentAt ? null : previous,
            );
            if (intoThreadId === undefined) {
              composerRef.current?.restoreText(text);
              if (consumedAttachments.length > 0) {
                setStagedAttachments(consumedAttachments);
              }
              videoLinks.unmarkJobsSent(consumedJobIds);
              void chatSend.unbindVideoJobs(turn.boundVideoJobIds);
            }
            // Whether the turn landed is unknown here, so the sibling stays
            // (its rows, if any, are reachable as ‹n/m›) — only the view
            // returns to the original tail.
            if (fork !== undefined) {
              rememberSelection(
                fork.parentId,
                fork.forkSequence,
                fork.restoreTo,
              );
            }
            sendFailedToast(error);
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
        // A turn that never started wrote nothing into the sibling.
        if (fork !== undefined) abandonBranch(fork);
        // The thread the first message needed (an archived project refuses
        // it) or the video links it binds were refused before any turn.
        sendFailedToast(error);
      }
    })();
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
          // Every key that makes `chosen` the version on screen — one on a
          // flat fork point, one per ancestor on a lineage written before
          // forks were flattened — flips locally and lands in one write.
          const chain = selectionChainFor(
            group.forkSequence,
            chosen,
            viewPath,
            branches,
          );
          setSelectionOverrides((previous) => {
            const next = { ...previous };
            for (const entry of chain) {
              next[entry.forkKey] = entry.selectedThreadId;
            }
            return next;
          });
          branchActions.select(threadId, chain);
        },
      });
    }
    return view;
    // rememberSelection is stable per render and derived from the same deps.
  }, [threadId, viewPath, branches, branchActions]);

  // Edit = a sibling branch carrying the history BEFORE the edited message;
  // the edited text is then sent into it through the normal turn. Resolves
  // whether the edit STARTED: a fork the door refused (a reached usage cap
  // answers before anything forks) is named like a refused send and hands
  // the draft back to the still-open edit form.
  const handleEditSubmitImpl = async (
    message: ChatMessageView,
    text: string,
  ): Promise<boolean> => {
    if (viewThreadId === undefined) return false;
    const forked = await branchActions.branchForEdit(viewThreadId, message.id);
    if (forked.status === 'refused') {
      refusalToast(forked.reason, forked.code);
      return false;
    }
    if (forked.status === 'failed') {
      toast({
        title: t('toast.sendFailed'),
        ...(forked.reason !== undefined ? { description: forked.reason } : {}),
        variant: 'destructive',
      });
      return false;
    }
    // The fork point is the server's: a "try again" sibling on screen is
    // another version of the same turn, so the edit hangs off ITS parent
    // and the selection is keyed there — three versions on one ‹n/m›, the
    // original among them.
    const { parentId, forkSequence } = forked;
    const restoreTo = selections[forkKey(parentId, forkSequence)] ?? parentId;
    rememberSelection(parentId, forkSequence, forked.id);
    handleSend(
      text,
      forked.id,
      { parentId, forkSequence, branchId: forked.id, restoreTo },
      message.parts.flatMap((part) =>
        part.type === 'attachment' && part.fileId !== undefined
          ? [
              {
                fileId: part.fileId,
                fileName: part.name,
                fileType: part.mediaType,
                fileSize: part.sizeBytes ?? 0,
              },
            ]
          : [],
      ),
    );
    return true;
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
    const rows = threadView.items;
    const prompt = rows
      .toReversed()
      .find((row) => row.role === 'user' && row.sequence < message.sequence);
    if (!prompt) return;
    void branchActions
      .branchForRegenerate(viewThreadId, message.id)
      .then(async (forked) => {
        // The door measured the budget before forking: a reached cap is
        // named as a refused send is, and nothing was created or selected.
        if (forked.status === 'refused') {
          refusalToast(forked.reason, forked.code);
          return;
        }
        if (forked.status === 'failed') {
          toast({
            title: t('regenerateFailed'),
            ...(forked.reason !== undefined
              ? { description: forked.reason }
              : {}),
            variant: 'destructive',
          });
          return;
        }
        const branchId = forked.id;
        // The fork point as the server resolved it (see the edit above).
        const { parentId, forkSequence } = forked;
        const restoreTo =
          selections[forkKey(parentId, forkSequence)] ?? parentId;
        rememberSelection(parentId, forkSequence, branchId);
        const outcome = await branchActions.regenerate(branchId, {
          ...modelPick,
          ...(selection.reasoningEffort !== undefined
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
          locale,
        });
        if (!outcome.refused) return;
        // A refusal that wrote nothing leaves the sibling without its
        // reply: undo the fork so the view returns to the original tail.
        // When the request itself failed, whether the turn landed is
        // unknown — the sibling stays reachable as ‹n/m›, only the view
        // returns.
        if (outcome.persisted === false) {
          abandonBranch({ parentId, forkSequence, branchId, restoreTo });
        } else if (outcome.persisted === undefined) {
          rememberSelection(parentId, forkSequence, restoreTo);
        }
        if (isBudgetRefusalCode(outcome.code)) {
          refusalToast(outcome.reason, outcome.code);
          return;
        }
        const { titleKey, description } = regenerateFailureToastContent(
          outcome,
          t,
        );
        toast({
          title: t(titleKey),
          ...(description !== undefined ? { description } : {}),
          variant: 'destructive',
        });
      });
  };

  // Fork = a VISIBLE copy of the conversation up to a message — a new chat
  // of its own, unlike the hidden siblings above.
  const handleForkImpl = (message: ChatMessageView) => {
    if (viewThreadId === undefined) return;
    const title = t('forkOf', {
      title: headerThread?.title ?? t('history.untitled'),
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
  const stableSend = useCallback((text: string) => {
    rowHandlersRef.current.send(text);
  }, []);

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

  const panelToggle = <HomePanelToggle />;
  // Another chat opening in place fades in; a chat born from its first
  // message is the same conversation continuing, so it does not.
  const threadSwapRef = useSwapFade<HTMLDivElement>(threadId, {
    fromEmpty: false,
  });
  // The tab names the chat, so several open chats stay apart in the browser.
  useDocumentTitle(
    headerThread?.title !== undefined
      ? documentTitle('chat', headerThread.title)
      : undefined,
  );
  const activeProject =
    headerThread?.projectId !== undefined
      ? headerProjects.find((project) => project.id === headerThread.projectId)
      : undefined;

  return (
    // The preview map's identity never changes — the provider re-renders
    // nothing; rows read the map during their own renders.
    <AttachmentPreviewProvider value={sentPreviewsRef.current}>
      <div className="flex min-h-0 flex-1 flex-row">
        {/* The page's skip link lands on `main`, which begins with the
            sidebar — every chat and project row a Tab stop. This one skips
            the sidebar and lands in the message box. */}
        <SkipLink targetId={COMPOSER_TEXTAREA_ID}>
          {t('aria.skipToComposer')}
        </SkipLink>
        <Stack
          ref={threadSwapRef}
          gap={0}
          className="mobile-nav-clearance mobile-nav-inset relative min-h-0 min-w-0 flex-1"
        >
          {/* Mobile header (<md): the Home panel and the floating header
            below are desktop-only — without this row a phone could neither
            get back to its Home list nor reach the conversation actions. */}
          <div className="border-border flex h-12 shrink-0 items-center border-b px-2 md:hidden">
            {/* Back to the Home list — where a phone keeps every chat, task
                and conversation (the desktop panel's content). */}
            <div className="flex w-9 justify-center">
              <HomeBackButton organizationId={organizationId} />
            </div>
            <div className="min-w-0 flex-1 px-2">
              {headerThread?.title !== undefined && (
                <Text variant="muted" className="truncate text-center text-sm">
                  {headerThread.title}
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
            {headerThread !== undefined && !threadNotFound ? (
              <ThreadHeader
                floating
                className="pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto"
                before={panelToggle}
                leading={
                  <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg">
                    <MessageCircle aria-hidden className="size-4" />
                  </span>
                }
                title={
                  <h1 className="truncate">
                    {headerThread.title ?? t('history.untitled')}
                  </h1>
                }
                meta={
                  activeProject !== undefined || headerThread.isShared ? (
                    <>
                      {activeProject !== undefined && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <ProjectAvatar
                            name={activeProject.name}
                            icon={activeProject.icon}
                            color={activeProject.color}
                            size={16}
                            variant="plain"
                            className="size-3 [&_svg]:size-3"
                          />
                          <span className="truncate">{activeProject.name}</span>
                        </span>
                      )}
                      {activeProject !== undefined && headerThread.isShared && (
                        <ThreadHeaderSeparator />
                      )}
                      {headerThread.isShared && (
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <Share2 aria-hidden className="size-3" />
                          {t('share.sharedIndicator')}
                        </span>
                      )}
                    </>
                  ) : undefined
                }
                actions={
                  <>
                    {canCreateTask && (
                      // The conversation's one verb: the hand-over to a
                      // project agent, where people look for it instead of
                      // inside the menu. Icon-only where the header is tight.
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={ListChecks}
                        onClick={() => setCreateTaskOpen(true)}
                        aria-label={t('createTask.headerButton')}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <span className="hidden @xl/thread-header:inline">
                          {t('createTask.headerButton')}
                        </span>
                      </Button>
                    )}
                    <DropdownMenu
                      align="end"
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          // Distinct from the sidebar rows' per-thread "More
                          // actions": a screen reader (and a test locator)
                          // must be able to tell the conversation-level menu
                          // apart.
                          aria-label={t('aria.threadActions')}
                        >
                          <Ellipsis className="text-muted-foreground size-5 p-0.25" />
                        </Button>
                      }
                      items={desktopMenuItems}
                    />
                  </>
                }
              />
            ) : (
              <div className="relative flex h-13 items-center px-4">
                {panelToggle}
              </div>
            )}
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
              pairCreatedAt={pair.createdAt}
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
              generating={
                generationInFlight || arenaBusyB || openArenaRound !== undefined
              }
              round={openArenaRound}
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
                  threadId={viewThreadId}
                  readOnly={!viewerIsOwner}
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
            ) : (
              <div className="shrink-0 px-4 pb-4">
                <BudgetBanner organizationId={organizationId} />
                {/* The tasks this conversation handed over, live. */}
                {threadId !== undefined && pair === null && (
                  <ChatTaskTray
                    organizationId={organizationId}
                    threadId={threadId}
                  />
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
                  textareaId={COMPOSER_TEXTAREA_ID}
                  draftKey={draftKey}
                  models={models}
                  subscriptionProviders={subscriptionProviders}
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
                  // Browser recognition remains independent; server fallback
                  // and uploaded media share the organization's resolver.
                  organizationId={organizationId}
                  transcriptionAvailable={voiceCapabilities.hasTranscription}
                  transcriptionUnavailableReason={
                    voiceCapabilities.transcriptionUnavailableReason
                  }
                  onTranscriptionUnavailable={handleTranscriptionUnavailable}
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

        <TranscriptionAvailabilityNotice
          open={transcriptionFailure !== null}
          onOpenChange={(open) => {
            if (!open) setTranscriptionFailure(null);
          }}
          reason={transcriptionFailure ?? undefined}
          setupAction={transcriptionSetupAction}
          onRetry={voiceCapabilities.refresh}
        />

        {/* Mounted only while open; exports read the view thread — the sibling
          actually on screen. */}
        {exportOpen && viewThreadId !== undefined && (
          <ExportChatDialog
            open={exportOpen}
            onOpenChange={setExportOpen}
            organizationId={organizationId}
            threadId={viewThreadId}
            threadTitle={headerThread?.title}
          />
        )}

        {/* The header menu's Create task — the task dialog, drafted from the
          sibling on screen, linking back to the root. */}
        {createTaskOpen &&
          threadId !== undefined &&
          viewThreadId !== undefined && (
            <CreateTaskFromChat
              open={createTaskOpen}
              onOpenChange={setCreateTaskOpen}
              organizationId={organizationId}
              threadId={threadId}
              viewThreadId={viewThreadId}
              threadTitle={headerThread?.title}
              projectId={headerThread?.projectId}
              viewerIsOwner={viewerIsOwner}
            />
          )}

        {/* The header menu's Share — status, link, republish, revoke. The
          link names the root; the snapshot is the sibling on screen. */}
        {threadId !== undefined && viewThreadId !== undefined && (
          <ShareChatDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            organizationId={organizationId}
            threadId={threadId}
            viewThreadId={viewThreadId}
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
