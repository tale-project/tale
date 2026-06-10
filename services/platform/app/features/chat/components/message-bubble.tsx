'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import {
  CopyIcon,
  CheckIcon,
  GitFork,
  Info,
  MoreHorizontal,
  Pencil,
  Bookmark,
  BookmarkCheck,
  TriangleAlert,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  memo,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { CitationsContext } from '../context/citations-context';
import {
  useChatAgents,
  useMessageMetadata,
  useFileUrls,
  useThreadLiveRoute,
  useThreadGenerationStart,
  type ThreadLiveRoute,
} from '../hooks/queries';
import { useCitations } from '../hooks/use-citations';
import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { useOnDemandSpeech } from '../hooks/use-on-demand-speech';
import {
  useVoiceModeEffective,
  useVoiceOutputChunker,
} from '../hooks/use-voice-output';
import {
  buildMessageSegments,
  deriveActivity,
} from '../utils/build-message-segments';
import { hasThoughtSteps } from '../utils/build-thought-timeline';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import { sanitizeChatError } from '../utils/sanitize-chat-error';
import { BlockedNotice } from './blocked-notice';
import {
  FileAttachmentDisplay,
  FilePartDisplay,
} from './message-bubble/file-displays';
import {
  ImagePreviewDialog,
  type GalleryImage,
} from './message-bubble/image-preview-dialog';
import type { Message } from './message-bubble/types';
import { MessageFeedback } from './message-feedback';
import { MessageInfoDialog } from './message-info-dialog';
import { MessageSegments } from './message-segments';
import { SourceCards } from './source-cards';
import { MessageThoughtHeader } from './thought-timeline';
import { VoiceOutputIndicator } from './voice-output-indicator';

export { ImagePreviewDialog } from './message-bubble/image-preview-dialog';

interface MessageBubbleProps extends ComponentPropsWithoutRef<'div'> {
  message: Message;
  organizationId?: string;
  /**
   * Text of the user message that produced this assistant reply. Forwarded to
   * the dev-only Direct TTFT probe so it can replay the real prompt. Undefined
   * for user messages and assistant replies with no preceding user turn.
   */
  precedingUserText?: string;
  hideFeedback?: boolean;
  onSendFollowUp?: (message: string) => void;
  onRetry?: () => void;
  /** Regenerate this assistant message as a new branch (behind the 3-dots menu). */
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onFork?: (messageId: string) => void;
  onSavePrompt?: (messageId: string, content: string) => void;
  onUnsavePrompt?: (messageId: string) => void;
  isSavedPrompt?: boolean;
  /** Extra content rendered in the user message toolbar (e.g. BranchNavigator). */
  toolbarExtra?: React.ReactNode;
  /**
   * True only for the thread's LAST assistant message. Its toolbar stays
   * always visible; every other message (assistant and user alike) reveals
   * its toolbar on hover/focus only, keeping history calm.
   */
  isLastAssistantMessage?: boolean;
  /**
   * True if this message's id was NOT in the chat-list's first-render
   * snapshot — i.e. it arrived via subscription during this mount, not
   * as part of history load. Drives the voice-output chunker's
   * fire/skip decision identity-based (no wall-clock comparison, no
   * server/client clock-skew dependency). Default false so consumers
   * that omit the prop never accidentally fire synthesis on history.
   */
  isFreshSinceMount?: boolean;
}

interface MessageArtifactPillsProps {
  organizationId: string;
  threadId: string;
  messageId: string;
}

// Artifact pills retired with the artifacts module — workspace files now
// surface via the right-pane workspace sidebar.
function MessageArtifactPillsComponent(_props: MessageArtifactPillsProps) {
  return null;
}

const MessageArtifactPills = memo(MessageArtifactPillsComponent);

function useMessageGallery(message: Message) {
  const imageAttachments = useMemo(
    () =>
      message.attachments?.filter((a) => a.fileType.startsWith('image/')) ?? [],
    [message.attachments],
  );

  const imageFileIds = useMemo(
    () => imageAttachments.filter((a) => !a.previewUrl).map((a) => a.fileId),
    [imageAttachments],
  );

  const { data: resolvedUrls } = useFileUrls(imageFileIds);

  const galleryImages = useMemo(() => {
    const images: GalleryImage[] = [];

    // FilePart images first (assistant-generated)
    if (message.fileParts) {
      for (const part of message.fileParts) {
        if (part.mediaType.startsWith('image/')) {
          images.push({
            src: part.url,
            alt: part.filename || 'Image',
          });
        }
      }
    }

    // Then attachment images (user-uploaded)
    for (const attachment of imageAttachments) {
      const url =
        attachment.previewUrl ||
        resolvedUrls?.find(
          (r: { fileId: string; url: string | null }) =>
            r.fileId === attachment.fileId,
        )?.url;
      if (url) {
        images.push({ src: url, alt: attachment.fileName });
      }
    }

    return images;
  }, [message.fileParts, imageAttachments, resolvedUrls]);

  return galleryImages;
}

function MessageBubbleComponent({
  message,
  className,
  organizationId,
  precedingUserText,
  hideFeedback,
  onSendFollowUp,
  onRetry,
  onRegenerate,
  onEdit,
  onFork,
  onSavePrompt,
  onUnsavePrompt,
  isSavedPrompt,
  toolbarExtra,
  isLastAssistantMessage = false,
  isFreshSinceMount = false,
  ...restProps
}: MessageBubbleProps) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;
  const voiceMode = useVoiceModeEffective(message.threadId);
  useVoiceOutputChunker({
    // Gate on assistant role explicitly. `!isUser` would let system
    // messages through (chat-messages.tsx coerces every non-user role
    // to 'assistant' for rendering, but the underlying `message.role`
    // is preserved here) and the chunker would synthesize system text
    // intended for the model, not the user.
    enabled: voiceMode.enabled && message.role === 'assistant',
    messageId: message.id,
    threadId: message.threadId,
    organizationId,
    text: message.content ?? '',
    isStreaming: !!isAssistantStreaming,
    isFreshSinceMount,
  });
  // On-demand "Speak out loud" (behind the message 3-dots): synthesizes this
  // finished reply through the provider TTS pipeline regardless of thread
  // voice mode, then force-enables the indicator below to play it.
  const onDemandSpeech = useOnDemandSpeech({
    messageId: message.id,
    threadId: message.threadId,
    organizationId,
    text: message.content ?? '',
  });
  const voiceIndicatorEnabled = voiceMode.enabled || onDemandSpeech.requested;

  const handleEditClick = useCallback(() => {
    if (onEdit) onEdit(message.id, message.content);
  }, [onEdit, message.id, message.content]);

  const handleForkClick = useCallback(() => {
    if (onFork) onFork(message.id);
  }, [onFork, message.id]);

  const [unsaveConfirmOpen, setUnsaveConfirmOpen] = useState(false);

  const handleBookmarkClick = useCallback(() => {
    if (isSavedPrompt) {
      setUnsaveConfirmOpen(true);
    } else if (onSavePrompt) {
      onSavePrompt(message.id, message.content);
    }
  }, [isSavedPrompt, onSavePrompt, message.id, message.content]);

  const handleConfirmUnsave = useCallback(() => {
    if (onUnsavePrompt) onUnsavePrompt(message.id);
    setUnsaveConfirmOpen(false);
  }, [onUnsavePrompt, message.id]);

  const [isCopied, setIsCopied] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Only assistant messages consume metadata (blockedReason gates on
  // assistant role below; citations render only for `!isUser`). Skipping the
  // subscription for user messages halves the per-message query count in a
  // typical thread. `MessageInfoDialog` already tolerates undefined metadata.
  const { metadata } = useMessageMetadata(
    message.role === 'assistant' ? message.id : null,
    message.threadId,
  );
  const { citations, hasCitations } = useCitations(metadata?.citations);
  // Guardrails block: when the pipeline tombstoned this message we replace
  // the entire content area with <BlockedNotice/> so reasoning, tool calls,
  // citations, and attachments are all hidden regardless of what the SDK
  // streamed before stopStream() fired.
  const blockedReason = metadata?.blockedReason;
  const isBlocked = !!blockedReason && message.role === 'assistant';

  // Image-generation agents show a ↻ Edit button on assistant image parts.
  const { agent: effectiveAgentForEdit } = useEffectiveAgent(
    organizationId ?? '',
  );
  const { agents: agentsForEdit } = useChatAgents(organizationId ?? '');
  const isImageGenAgent =
    agentsForEdit?.find((a) => a.name === effectiveAgentForEdit?.name)
      ?.primaryBehavior === 'image-generation';
  // When this turn came from Auto routing, resolve the routed agent's display
  // name for the routing chip / info dialog. Falls back to the raw slug — the
  // fallback default agent may not be in the chat-visible list.
  const routedAgentName = metadata?.agentSlug
    ? (agentsForEdit?.find((a) => a.name === metadata.agentSlug)?.displayName ??
      metadata.agentSlug)
    : undefined;
  const autoRouteReason = metadata?.autoRouteReason;
  // Live Auto-route for the IN-FLIGHT turn (from the thread-level provider). The
  // persisted `metadata.autoRouteReason` only lands at turn completion, so
  // without this the routing step would vanish from send → completion. Gated to
  // the CURRENT turn's bubble — `threadLiveRoute` is itself null outside
  // generation (the query gates it on isGenerating + it's cleared at turn
  // start/end), so the only bubble that should adopt it is the one still
  // streaming OR not-yet-finalized (no metadata row yet). Every prior turn's
  // bubble already has a metadata row, so it keeps its own `autoRouteReason`.
  // This also closes the brief window where a short answer has finished
  // streaming (isStreaming flipped false) but its metadata hasn't propagated.
  const threadLiveRoute = useThreadLiveRoute();
  // The in-flight turn's server start, shared with the gap shell so the
  // in-bubble timeline's live timer continues the SAME clock (no reset at the
  // handoff). Null on idle threads / history bubbles — those read the persisted
  // thinkingDurationMs instead.
  const turnStartMs = useThreadGenerationStart() ?? undefined;
  const liveRouteForBubble =
    isAssistantStreaming || !metadata ? threadLiveRoute : null;
  // Latch the live route per-bubble: at turn-end the live route is cleared (its
  // query gates on isGenerating) a beat BEFORE the persisted metadata.autoRouteReason
  // propagates — without latching, a short answer's timeline would blink empty
  // in that window. Hold the last-seen live route until metadata takes over.
  const latchedLiveRouteRef = useRef<ThreadLiveRoute | null>(null);
  if (liveRouteForBubble) latchedLiveRouteRef.current = liveRouteForBubble;
  const effectiveLiveRoute = liveRouteForBubble ?? latchedLiveRouteRef.current;
  const { setEditingImageRef, setDismissedImageKey } = useChatLayout();
  const handleEditImagePart = useCallback(
    (part: { url: string; mediaType: string; filename?: string }) => {
      let fileId = '';
      try {
        fileId = new URL(part.url).searchParams.get('id') ?? '';
      } catch {
        // Non-storage URL (e.g. data URL); edit reference won't resolve server-side
      }
      setEditingImageRef({
        fileId,
        url: part.url,
        mimeType: part.mediaType,
        fileName: part.filename,
      });
      setDismissedImageKey(null);
    },
    [setEditingImageRef, setDismissedImageKey],
  );
  const citationNumbers = useMemo(() => new Set(citations.keys()), [citations]);
  const citationsContextValue = useMemo(() => ({ citations }), [citations]);
  const galleryImages = useMessageGallery(message);

  // Referentially-stable `parts`: the message list rebuilds `parts` with a fresh
  // array identity on EVERY streamed token (use-message-processing re-maps the
  // whole list), so even when the timeline-relevant structure is unchanged the
  // reference churns and re-renders `ThoughtTimeline` (which is not memoized) per
  // token. Collapse that churn to the SAME granularity the bubble's own memo
  // comparator uses (`sameParts`: length + per-part type/state/toolCallId/text-
  // length): hold the previous reference whenever `sameParts` holds, so the
  // timeline only re-renders on a genuine structural change. Identical render
  // output — `sameParts` is exactly the bubble-level "did anything renderable
  // change" predicate, applied one level deeper.
  const stablePartsRef = useRef(message.parts);
  if (!sameParts(stablePartsRef.current, message.parts)) {
    stablePartsRef.current = message.parts;
  }
  const stableParts = stablePartsRef.current;

  const displayContent = message.content ?? '';
  // Thought-process timeline (assistant only): reasoning + tool activity from
  // the message parts. Drives bubble padding so an empty-but-thinking bubble
  // still has chrome. Hidden for guardrails-blocked messages. Use the cheap
  // predicate here — ThoughtTimeline builds the full step list itself.
  //
  // No metadata-loading gate. For a message first observed as NON-streaming
  // (history reload of an already-blocked message) ThoughtTimeline is COLLAPSED
  // by default (active = isStreaming = false → expanded = userToggled), so it
  // can only flash the one-line summary ("used N tools"), never the raw
  // chain-of-thought text, and <BlockedNotice/> swaps the content out the
  // instant `blockedReason` resolves. The streamed-then-output-blocked case is
  // a SEPARATE, pre-existing window: a live output-direction block streams
  // reasoning deltas (rendered expanded while active) before the tombstone +
  // blockedReason propagate, so reasoning IS briefly visible there — gating
  // showTimeline during streaming to hide it would reintroduce the stream-end
  // blink (the `stream:<id>` row swaps to the persisted `_id`, recreating a
  // cold metadata query) and any latch bridging that swap reopened the leak, so
  // we accept the live window and rely on collapse-by-default for history.
  // Render the timeline for: turns with reasoning/tool steps, AND Auto-routed
  // turns (so the "Routed to X" step persists, COLLAPSED, alongside the answer
  // instead of vanishing when output starts) — sourced live while streaming
  // (`liveRouteForBubble`) and from persisted metadata once the turn completes
  // (`autoRouteReason`). A plain pinned turn with neither still renders nothing.
  const showTimeline =
    !isUser &&
    !isBlocked &&
    (hasThoughtSteps(stableParts) || !!autoRouteReason || !!effectiveLiveRoute);
  // Map each filePart/attachment to its gallery index (-1 for non-images)
  const { filePartGalleryIndices, attachmentGalleryIndices } = useMemo(() => {
    let idx = 0;
    const fpIndices =
      message.fileParts?.map((p) =>
        p.mediaType.startsWith('image/') ? idx++ : -1,
      ) ?? [];
    const attIndices =
      message.attachments?.map((a) =>
        a.fileType.startsWith('image/') ? idx++ : -1,
      ) ?? [];
    return {
      filePartGalleryIndices: fpIndices,
      attachmentGalleryIndices: attIndices,
    };
  }, [message.fileParts, message.attachments]);

  const openGallery = useCallback((index: number) => {
    setGalleryIndex(index);
    setIsGalleryOpen(true);
  }, []);

  // The ordered, interleaved render plan (text / reasoning / tool segments).
  // Memoized on the stabilized parts ref so it recomputes only on a genuine
  // structural change, not on every streamed token.
  const messageSegments = useMemo(
    () => buildMessageSegments(stableParts),
    [stableParts],
  );
  // The current live activity (drives the header's state-based label).
  const activity = useMemo(
    () => deriveActivity(messageSegments.segments),
    [messageSegments.segments],
  );
  // `hasAnswerStarted` is the boolean `!!displayContent`, which flips once
  // (empty → non-empty) and then stays stable through the answer stream.
  const hasAnswerStarted = !!displayContent;

  // Post-answer toolbar gating: the toolbar appears only after the typewriter
  // has fully REVEALED the answer, not merely when the server stream ends —
  // the drain phase keeps typing for a while after `isStreaming` flips false,
  // and a toolbar popping in mid-drain gets pushed down by every revealed
  // segment (a visible layout shift). The completion signal travels
  // MessageSegments → AssistantMessageContent → the last TypewriterText's
  // `onComplete`. History bubbles (never observed streaming) start done.
  //
  // The toolbar is its OWN reveal step: it fades in one segment-beat AFTER
  // the last text segment, never in the same instant — so the answer's final
  // clause finishes its fade before the controls appear.
  const TOOLBAR_REVEAL_DELAY_MS = 450;
  const [revealDone, setRevealDone] = useState(!isAssistantStreaming);
  // Whether THIS mount observed the live reveal. A remounted completed
  // message (chat or branch/version switch) starts done — its toolbar must
  // render visible WITHOUT replaying the entrance animation, or every switch
  // re-fades the toolbar block.
  const sawLiveRevealRef = useRef(isAssistantStreaming);
  if (isAssistantStreaming) sawLiveRevealRef.current = true;
  const revealDelayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleRevealComplete = useCallback(() => {
    if (revealDelayTimerRef.current) clearTimeout(revealDelayTimerRef.current);
    revealDelayTimerRef.current = setTimeout(
      () => setRevealDone(true),
      TOOLBAR_REVEAL_DELAY_MS,
    );
  }, []);
  useEffect(() => {
    return () => {
      if (revealDelayTimerRef.current) {
        clearTimeout(revealDelayTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (isAssistantStreaming) {
      setRevealDone(false);
      return undefined;
    }
    const lastSegment =
      messageSegments.segments[messageSegments.segments.length - 1];
    // Terminal states and turns with no trailing text reveal have no
    // typewriter completion to wait for.
    if (
      message.isAborted ||
      message.isFailed ||
      !lastSegment ||
      lastSegment.kind !== 'text'
    ) {
      setRevealDone(true);
      return undefined;
    }
    // Safety net: the drain is bounded (drainMaxTotalMs ≈ 8s). If the
    // completion callback never fires (e.g. voice-first reveal kept the text
    // hidden), surface the toolbar anyway.
    const timer = setTimeout(() => setRevealDone(true), 10_000);
    return () => clearTimeout(timer);
  }, [
    isAssistantStreaming,
    message.isAborted,
    message.isFailed,
    messageSegments,
  ]);
  const timeToFirstTokenMs = metadata?.timeToFirstTokenMs;
  // Pre-answer wall-clock the user waited, INCLUDING Auto-routing (server-
  // anchored, same origin as the live timer) — preferred for the "Thought for
  // Ns" summary. `timeToFirstTokenMs` is the legacy fallback for messages
  // persisted before `thinkingDurationMs` existed.
  const thinkingDurationMs = metadata?.thinkingDurationMs;
  const outputTokens = metadata?.outputTokens;
  // Which agent handled an Auto-routed turn (and why). Sourced live while
  // streaming (shows the instant routing resolves) and from persisted metadata
  // once the turn lands. Rendered as the "Routed to X" chip inline at the top
  // of the segment stream (routing precedes any part, so it isn't a segment).
  const resolvedRoutedAgentName =
    (autoRouteReason ? routedAgentName : undefined) ??
    effectiveLiveRoute?.agentName;
  const resolvedRouteReason = autoRouteReason ?? effectiveLiveRoute?.reason;
  // Show the thought HEADER only when the turn has a GENUINE thought process —
  // reasoning, tools, or skills. A plain answer (incl. a plain Auto turn that
  // merely routed) must NOT flash a "Thinking…/Responding…" header for the ~1s
  // before its first token: that empty header cycling Thinking→Responding→gone
  // is the "thought process flashes for a second" artifact. The pre-answer wait
  // is already conveyed by the gap-shell ThinkingIndicator (before the bubble);
  // the "Routed to X" chip is rendered separately inside MessageSegments.
  const hasActualThought =
    messageSegments.hasReasoning ||
    messageSegments.toolCount > 0 ||
    messageSegments.skillCount > 0;
  // Memoize the header strip element so it re-renders only when its inputs
  // genuinely change, not on every streamed answer token.
  const thoughtHeader = useMemo(
    () =>
      hasActualThought ? (
        <MessageThoughtHeader
          isStreaming={!!isAssistantStreaming}
          hasAnswerStarted={hasAnswerStarted}
          // markGenerating → first answer token, routing INCLUDED; falls back to
          // the legacy timeToFirstTokenMs for old messages. When NEITHER exists
          // (a reasoning/tool-only or aborted turn) the header shows the honest
          // duration-less "Showed its reasoning" summary.
          durationMs={thinkingDurationMs ?? timeToFirstTokenMs}
          tokenCount={outputTokens}
          toolCount={messageSegments.toolCount}
          skillCount={messageSegments.skillCount}
          hasReasoning={messageSegments.hasReasoning}
          turnStartMs={turnStartMs}
          activity={activity}
        />
      ) : null,
    [
      hasActualThought,
      isAssistantStreaming,
      hasAnswerStarted,
      thinkingDurationMs,
      timeToFirstTokenMs,
      outputTokens,
      messageSegments,
      turnStartMs,
      activity,
    ],
  );

  // Synchronous initial overflow check — runs before paint so the "Show More"
  // button is included in the first layout commit (no two-frame cascade).
  useLayoutEffect(() => {
    if (!isUser || !contentRef.current || isExpanded) return;
    setIsOverflowing(
      contentRef.current.scrollHeight > contentRef.current.clientHeight,
    );
  }, [isUser, isExpanded, displayContent]);

  // Debounced ResizeObserver for subsequent resize events (e.g. window resize).
  useEffect(() => {
    if (!isUser || !contentRef.current || isExpanded) return undefined;
    const el = contentRef.current;
    let frameId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setIsOverflowing(el.scrollHeight > el.clientHeight);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isUser, isExpanded, displayContent]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Rendered markdown serializes to text/plain with a line break at every block
  // boundary, so a manual select-and-copy of an assistant reply pastes with
  // stacks of blank lines. Rewrite the clipboard with a normalized copy — but
  // only when it actually differs, so an already-clean selection keeps the
  // browser's native (rich) copy untouched.
  const handleCopySelection = useCallback((e: React.ClipboardEvent) => {
    const selected = window.getSelection()?.toString() ?? '';
    if (!selected) return;
    const normalized = normalizeCopiedText(selected);
    if (normalized === selected) return;
    e.clipboardData.setData('text/plain', normalized);
    e.preventDefault();
  }, []);

  const handleCopy = async () => {
    try {
      // Normalize before writing so the copy button never pastes the stray
      // trailing newlines a streamed/persisted reply can carry — matching the
      // manual-selection path (`handleCopySelection`) which already normalizes.
      await navigator.clipboard.writeText(normalizeCopiedText(message.content));
      setIsCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleInfoClick = () => {
    setIsInfoDialogOpen(true);
  };

  // "Something went wrong": a failed reply, or an aborted reply that
  // surfaced an error. For these we collapse the toolbar to just Show Info
  // (copy / fork / feedback / regenerate aren't useful on a broken turn —
  // the inline Try-again button covers retry).
  const isErrored =
    !isUser && (!!message.isFailed || (!!message.isAborted && !!message.error));

  // 3-dots overflow menu (assistant, non-error): Try again regenerates this
  // turn as a branch; Speak out loud reads it via the provider TTS pipeline.
  const canSpeak = !!organizationId && !!message.threadId;
  const moreMenuGroups: DropdownMenuGroup[] = [
    [
      ...(onRegenerate
        ? [
            {
              type: 'item' as const,
              label: tChat('tryAgain'),
              icon: RotateCcw,
              onClick: () => onRegenerate(message.id),
            },
          ]
        : []),
      ...(canSpeak
        ? [
            {
              type: 'item' as const,
              label: tChat('speakOutLoud'),
              icon: Volume2,
              onClick: onDemandSpeech.speak,
            },
          ]
        : []),
    ],
  ];
  const moreMenu =
    moreMenuGroups[0].length > 0 ? (
      <DropdownMenu
        align="end"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="p-1"
            aria-label={tChat('moreActions')}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
        items={moreMenuGroups}
      />
    ) : null;

  const infoButton = (
    <Tooltip content={t('actions.showInfo')} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        className="p-1"
        onClick={handleInfoClick}
      >
        <Info className="size-4" />
      </Button>
    </Tooltip>
  );

  return (
    <div
      className={cn(
        'group/message',
        isUser ? 'flex flex-col items-end' : 'flex justify-start',
        className,
      )}
      {...restProps}
    >
      <div
        className={cn(
          'rounded-2xl',
          isUser
            ? 'bg-muted text-foreground max-w-xs lg:max-w-md'
            : 'text-foreground bg-background w-full min-w-0',
          (displayContent || message.isAborted || isBlocked || showTimeline) &&
            'px-4 py-3',
        )}
      >
        {/* Thought-process HEADER strip (state-based label + timing summary):
            above the answer, persists collapsed in history. Hidden for
            guardrails-blocked messages. The reasoning/tool DETAIL renders
            interleaved within the body below. Memoized so it doesn't re-render
            on every streamed token. */}
        {thoughtHeader}
        {isBlocked && blockedReason ? (
          <BlockedNotice
            code={blockedReason.code}
            direction={blockedReason.direction}
            categoryIds={blockedReason.categoryIds}
          />
        ) : (
            isUser
              ? !!displayContent
              : displayContent || messageSegments.segments.length > 0
          ) ? (
          <div
            className="text-sm leading-5"
            // Assistant replies are rendered markdown — normalize the copied
            // text/plain so it doesn't paste with stacks of blank lines. User
            // messages are plain pre-wrapped text, so their copy is left intact
            // (collapsing the user's own blank lines would be wrong).
            onCopy={isUser ? undefined : handleCopySelection}
          >
            <div
              ref={isUser ? contentRef : undefined}
              className={cn(
                isUser && !isExpanded && 'max-h-96 overflow-hidden',
              )}
            >
              {isUser ? (
                <p className="break-words whitespace-pre-wrap">
                  {displayContent}
                </p>
              ) : (
                <CitationsContext.Provider value={citationsContextValue}>
                  {/*
                   * Voice-output indicator: lifted to the TOP of the
                   * assistant bubble (was previously below the message
                   * text) so the play / "Speaking…" affordance is the
                   * first thing the eye finds when voice mode is on.
                   * Left-aligned with the assistant text — putting it
                   * `justify-end` would float it to the right edge of
                   * the row where the USER's messages live, breaking
                   * the implicit "this control belongs to the
                   * assistant turn" affordance.
                   *
                   * Hidden entirely when voice mode is off; the message
                   * then renders with no extra chrome.
                   */}
                  {voiceIndicatorEnabled && message.threadId && (
                    <div className="mb-2 flex items-center justify-start">
                      <VoiceOutputIndicator
                        enabled
                        messageId={message.id}
                        threadId={message.threadId}
                        isStreaming={!!isAssistantStreaming}
                        organizationId={organizationId}
                        isFreshSinceMount={isFreshSinceMount}
                      />
                    </div>
                  )}
                  <MessageSegments
                    segments={messageSegments.segments}
                    active={!!isAssistantStreaming}
                    citationNumbers={citationNumbers}
                    onSendFollowUp={onSendFollowUp}
                    messageId={message.id}
                    threadId={message.threadId}
                    voiceModeEnabled={voiceMode.enabled}
                    isFreshSinceMount={isFreshSinceMount}
                    routedAgentName={resolvedRoutedAgentName}
                    routeReason={resolvedRouteReason}
                    onRevealComplete={handleRevealComplete}
                  />
                  {organizationId && message.threadId && (
                    <MessageArtifactPills
                      organizationId={organizationId}
                      threadId={message.threadId}
                      messageId={message.id}
                    />
                  )}
                </CitationsContext.Provider>
              )}
            </div>
            {isUser && (isOverflowing || isExpanded) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-foreground mt-1 text-xs"
                >
                  {isExpanded ? tChat('showLess') : tChat('showMore')}
                </button>
              </div>
            )}
            {message.isFailed && (
              <div
                className="mt-3 flex flex-col gap-2"
                role="alert"
                aria-live="polite"
              >
                <div className="text-destructive flex items-center gap-2">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="text-sm font-medium">
                    {tChat('errorGenerating')}
                  </span>
                </div>
                {(() => {
                  const sanitized = sanitizeChatError(message.error);
                  return (
                    <>
                      <p className="text-muted-foreground text-[13px]">
                        {tChat(sanitized.i18nKey)}
                      </p>
                      {sanitized.rawMessage && (
                        <p className="text-muted-foreground text-xs break-all whitespace-pre-wrap opacity-70">
                          {sanitized.rawMessage}
                        </p>
                      )}
                    </>
                  );
                })()}
                {onRetry && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-foreground w-fit gap-1.5 rounded-lg border-[#E5E7EB] bg-transparent px-3 py-1.5 text-[13px] font-medium"
                    onClick={onRetry}
                  >
                    <RotateCcw className="size-3.5" />
                    {tChat('retryGeneration')}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          message.isAborted &&
          (message.error ? (
            <div
              className="mt-3 flex flex-col gap-2"
              role="alert"
              aria-live="polite"
            >
              <div className="text-destructive flex items-center gap-2">
                <TriangleAlert className="size-4 shrink-0" />
                <span className="text-sm font-medium">
                  {tChat('errorGenerating')}
                </span>
              </div>
              {(() => {
                const sanitized = sanitizeChatError(message.error);
                return (
                  <>
                    <p className="text-muted-foreground text-[13px]">
                      {tChat(sanitized.i18nKey)}
                    </p>
                    {sanitized.rawMessage && (
                      <p className="text-muted-foreground text-xs break-all whitespace-pre-wrap opacity-70">
                        {sanitized.rawMessage}
                      </p>
                    )}
                  </>
                );
              })()}
              {onRetry && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-foreground w-fit gap-1.5 rounded-lg border-[#E5E7EB] bg-transparent px-3 py-1.5 text-[13px] font-medium"
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3.5" />
                  {tChat('retryGeneration')}
                </Button>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground flex items-center gap-1.5 text-sm italic">
              <Square className="size-3" />
              {tChat('generationStopped')}
            </div>
          ))
        )}

        {message.fileParts && message.fileParts.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {message.fileParts.map((part, i) => {
              const galleryIdx = filePartGalleryIndices[i];
              const isAssistantImage =
                message.role === 'assistant' &&
                part.mediaType.startsWith('image/');
              return (
                <FilePartDisplay
                  key={part.url}
                  filePart={part}
                  organizationId={organizationId}
                  onImageClick={
                    galleryIdx >= 0 ? () => openGallery(galleryIdx) : undefined
                  }
                  onEditImage={
                    isImageGenAgent && isAssistantImage
                      ? () => handleEditImagePart(part)
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.attachments.map((attachment, i) => {
              const galleryIdx = attachmentGalleryIndices[i];
              return (
                <FileAttachmentDisplay
                  key={attachment.fileId}
                  attachment={attachment}
                  onImageClick={
                    galleryIdx >= 0 ? () => openGallery(galleryIdx) : undefined
                  }
                />
              );
            })}
          </div>
        )}
        {/* Errored turn: only Show Info is useful — collapse the toolbar.
            Entrance animation only on a live transition, not on remount. */}
        {!isUser && !isAssistantStreaming && isErrored && (
          <div
            className={cn(
              'flex items-start gap-1 pt-2',
              sawLiveRevealRef.current && 'animate-content-in',
            )}
          >
            {infoButton}
          </div>
        )}

        {!isUser &&
          !isAssistantStreaming &&
          revealDone &&
          !isErrored &&
          (!!displayContent ||
            (message.fileParts && message.fileParts.length > 0)) && (
            // Fade the post-answer toolbar in (opacity-only, no layout shift)
            // once the typewriter has fully revealed the answer. Only the
            // LAST assistant message keeps its toolbar always visible —
            // history toolbars reveal on hover/focus to keep the thread calm.
            // The toolbar enters like a stream segment (fade + lift via
            // `animate-toolbar-in`), one beat after the last text segment.
            // Its fill-mode pins opacity at 1, which would defeat the
            // hover-hide — so the entrance applies only to the always-visible
            // last-message toolbar. Touch devices have no hover: keep history
            // toolbars visible there (pointer-coarse) so actions stay
            // reachable.
            <div
              className={cn(
                isLastAssistantMessage
                  ? // Entrance animation only when the answer was revealed live
                    // in this mount — a remounted completed message renders its
                    // toolbar statically (no re-fade on chat/version switch).
                    sawLiveRevealRef.current && 'animate-toolbar-in'
                  : 'opacity-0 transition-opacity duration-200 focus-within:opacity-100 pointer-coarse:opacity-100 group-hover/message:opacity-100',
              )}
            >
              {!hideFeedback && organizationId && message.threadId ? (
                <MessageFeedback
                  messageId={message.id}
                  threadId={message.threadId}
                  organizationId={organizationId}
                  before={
                    <>
                      <Tooltip
                        content={
                          isCopied ? t('actions.copied') : t('actions.copy')
                        }
                        side="bottom"
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="p-1"
                          onClick={handleCopy}
                        >
                          {isCopied ? (
                            <CheckIcon className="text-success size-4" />
                          ) : (
                            <CopyIcon className="size-4" />
                          )}
                        </Button>
                      </Tooltip>
                      {infoButton}
                    </>
                  }
                  after={
                    <>
                      {onFork && (
                        <Tooltip content={tChat('forkChat')} side="bottom">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="p-1"
                            onClick={handleForkClick}
                          >
                            <GitFork className="size-4" />
                          </Button>
                        </Tooltip>
                      )}
                      {moreMenu}
                    </>
                  }
                />
              ) : (
                <div className="flex items-start gap-1 pt-2">
                  <Tooltip
                    content={isCopied ? t('actions.copied') : t('actions.copy')}
                    side="bottom"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="p-1"
                      onClick={handleCopy}
                    >
                      {isCopied ? (
                        <CheckIcon className="text-success size-4" />
                      ) : (
                        <CopyIcon className="size-4" />
                      )}
                    </Button>
                  </Tooltip>
                  {infoButton}
                  {onFork && (
                    <Tooltip content={tChat('forkChat')} side="bottom">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="p-1"
                        onClick={handleForkClick}
                      >
                        <GitFork className="size-4" />
                      </Button>
                    </Tooltip>
                  )}
                  {moreMenu}
                </div>
              )}
            </div>
          )}

        {galleryImages.length > 0 && (
          <ImagePreviewDialog
            isOpen={isGalleryOpen}
            onOpenChange={setIsGalleryOpen}
            src={galleryImages[0].src}
            alt={galleryImages[0].alt}
            images={galleryImages}
            activeIndex={galleryIndex}
            onActiveIndexChange={setGalleryIndex}
          />
        )}

        {!isUser && hasCitations && !isAssistantStreaming && (
          <SourceCards citations={citations} organizationId={organizationId} />
        )}

        <MessageInfoDialog
          isOpen={isInfoDialogOpen}
          onOpenChange={setIsInfoDialogOpen}
          messageId={message.id}
          threadId={message.threadId}
          timestamp={message.timestamp}
          metadata={metadata}
          organizationId={organizationId}
          precedingUserText={precedingUserText}
          routedAgentName={routedAgentName}
        />
      </div>
      {isUser && (onEdit || onSavePrompt || toolbarExtra) && (
        // Own-message toolbar: hover/focus-revealed (opacity-only, so no
        // layout shift) — matches the calmer history-toolbar behavior. Touch
        // devices have no hover, so it stays visible there (pointer-coarse).
        <div className="flex items-center justify-end gap-0.5 pt-0.5 opacity-0 transition-opacity duration-200 group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          {(onSavePrompt || isSavedPrompt) && !!displayContent && (
            <Tooltip
              content={
                isSavedPrompt ? tChat('unsavePrompt') : tChat('savePrompt')
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                onClick={handleBookmarkClick}
              >
                {isSavedPrompt ? (
                  <BookmarkCheck className="text-primary size-3.5" />
                ) : (
                  <Bookmark className="size-3.5" />
                )}
              </Button>
            </Tooltip>
          )}
          {onEdit && !!displayContent && (
            <Tooltip content={tChat('editMessage')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-1"
                onClick={handleEditClick}
              >
                <Pencil className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          {toolbarExtra}
        </div>
      )}

      <ConfirmDialog
        open={unsaveConfirmOpen}
        onOpenChange={setUnsaveConfirmOpen}
        title={tChat('unsavePrompt')}
        description={tChat('unsavePromptConfirm')}
        confirmText={tChat('unsavePromptAction')}
        onConfirm={handleConfirmUnsave}
        variant="destructive"
      />
    </div>
  );
}

/**
 * Value-compare attachments. The message list rebuilds `attachments`/`fileParts`
 * arrays with fresh references on every streamed token (use-message-processing.ts
 * re-maps the whole list), so a reference check would re-render every
 * attachment-bearing bubble on each tick. A length + per-item value check keeps
 * those bubbles stable while still catching genuine changes — crucially the
 * render-driving fields (`previewUrl`/`fileName`/`fileType`), not just `fileId`,
 * so a thumbnail resolving in place (same id, new previewUrl) still re-renders.
 */
function sameAttachments(
  a: Message['attachments'],
  b: Message['attachments'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].fileId !== b[i].fileId ||
      a[i].fileType !== b[i].fileType ||
      a[i].previewUrl !== b[i].previewUrl ||
      a[i].fileName !== b[i].fileName
    )
      return false;
  }
  return true;
}

function sameFileParts(
  a: Message['fileParts'],
  b: Message['fileParts'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].url !== b[i].url ||
      a[i].mediaType !== b[i].mediaType ||
      a[i].filename !== b[i].filename
    )
      return false;
  }
  return true;
}

/**
 * Structural compare of UIMessage parts for the thought-process timeline. The
 * message list rebuilds `parts` with fresh references on every streamed token,
 * so a reference check would never re-render — but a deep check would re-render
 * every bubble per tick. Compare length + per-part identity (type, state,
 * text length, toolCallId): enough to catch reasoning growth and tool
 * state transitions without churning unrelated bubbles.
 */
function isPartRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function sameParts(a: Message['parts'], b: Message['parts']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (!isPartRecord(pa) || !isPartRecord(pb)) {
      if (pa !== pb) return false;
      continue;
    }
    if (pa.type !== pb.type) return false;
    if (pa.state !== pb.state) return false;
    if (pa.toolCallId !== pb.toolCallId) return false;
    const ta = typeof pa.text === 'string' ? pa.text.length : 0;
    const tb = typeof pb.text === 'string' ? pb.text.length : 0;
    if (ta !== tb) return false;
  }
  return true;
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.isAborted === nextProps.message.isAborted &&
      prevProps.message.isFailed === nextProps.message.isFailed &&
      sameAttachments(
        prevProps.message.attachments,
        nextProps.message.attachments,
      ) &&
      sameFileParts(prevProps.message.fileParts, nextProps.message.fileParts) &&
      sameParts(prevProps.message.parts, nextProps.message.parts) &&
      prevProps.message.threadId === nextProps.message.threadId &&
      prevProps.className === nextProps.className &&
      prevProps.organizationId === nextProps.organizationId &&
      prevProps.precedingUserText === nextProps.precedingUserText &&
      prevProps.hideFeedback === nextProps.hideFeedback &&
      prevProps.onSendFollowUp === nextProps.onSendFollowUp &&
      prevProps.onRetry === nextProps.onRetry &&
      prevProps.onRegenerate === nextProps.onRegenerate &&
      prevProps.onEdit === nextProps.onEdit &&
      prevProps.onFork === nextProps.onFork &&
      prevProps.isSavedPrompt === nextProps.isSavedPrompt &&
      prevProps.toolbarExtra === nextProps.toolbarExtra &&
      prevProps.isLastAssistantMessage === nextProps.isLastAssistantMessage &&
      prevProps.isFreshSinceMount === nextProps.isFreshSinceMount
    );
  },
);
