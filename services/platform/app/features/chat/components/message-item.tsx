'use client';

/**
 * One message of the transcript.
 *
 * The user's turns read as compact right-aligned bubbles (long ones clamp
 * with a Show more toggle; a hover pencil swaps the bubble for the edit
 * form); the assistant's read as the page itself — full width, markdown, the
 * actions toolbar underneath. A forked message carries the ‹ n/m › sibling
 * navigator. Tool and system rows keep their chip presentation. History items
 * rasterize lazily (`content-visibility`) so a long thread costs what the
 * viewport shows, not what the conversation accumulated.
 */

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { CircleStop, Pencil } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type Ref,
} from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { isPausingChatTool } from '@/lib/chat/tools';
import { useT } from '@/lib/i18n/client';
import { isStoppedReason } from '@/lib/shared/chat-errors';
import { cn } from '@/lib/utils/cn';

import { useOnDemandSpeech } from '../hooks/use-on-demand-speech';
import {
  messageThinkingAnchor,
  toSeconds,
  useThinkingTimer,
} from '../hooks/use-thinking-timer';
import { useVoiceOutputChunker } from '../hooks/use-voice-output';
import { messagePlainText } from '../lib/message-text';
import type { ChatMessageItem, ChatMessageView } from '../types';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import { BlockedNotice } from './blocked-notice';
import { BranchNavigator } from './branch-navigator';
import { ChatErrorDisplay } from './chat-error-display';
import {
  GenerationIncompleteNotice,
  isGenerationIncomplete,
} from './generation-incomplete-notice';
import { MessageEditForm } from './message-edit-form';
import { MessageMarkdown } from './message-markdown';
import { MessageParts } from './message-parts';
import { MessageToolbar } from './message-toolbar';
import { SourceCards } from './source-cards';
import { StepLimitNotice, stepLimitHit } from './step-limit-notice';
import { SystemNotice } from './system-notice';
import { ThinkingDots } from './thinking-dots';
import { ThoughtTimeline } from './thought-timeline';
import { VoiceOutputIndicator } from './voice-output-indicator';

/** Lazy rasterization for history rows; the intrinsic size keeps the
 * scrollbar honest while off-screen items stay unrendered. */
const HISTORY_CONTENT_VISIBILITY =
  '[content-visibility:auto] [contain-intrinsic-size:auto_200px]';

/** Breathing room between the last revealed segment and the toolbar's
 * arrival, so the chrome never lands inside the settling text. */
const TOOLBAR_REVEAL_DELAY_MS = 450;
/** A reveal that never reports completion still frees the toolbar. */
const REVEAL_SAFETY_TIMEOUT_MS = 10_000;

/** The ‹ n/m › state of the fork point AT this message, when one exists. */
export interface MessageForkGroupView {
  readonly index: number;
  readonly total: number;
  readonly onSelect: (index: number) => void;
}

interface MessageItemProps {
  message: ChatMessageItem;
  isLast: boolean;
  /** The row sits in the history region (above the last user message) —
   * rasterized lazily; the anchored/response rows always render fully. */
  isHistory?: boolean;
  /** The scroll anchor ref — set on the LAST USER row only; the send-snap
   * scrolls this element to the viewport top. */
  rootRef?: Ref<HTMLLIElement>;
  /** The conversation the message belongs to. Absent on surfaces that carry
   * no per-message actions needing it (a shared snapshot). */
  organizationId?: string;
  threadId?: string;
  /** The caller's stored rating for this message, from the thread map. */
  feedbackRating?: 'positive' | 'negative';
  /** The sibling flipper for a fork at this message's sequence. */
  forkGroup?: MessageForkGroupView;
  /** Start an edited sibling of this user message. Absent = not editable. */
  onEditSubmit?: (message: ChatMessageView, text: string) => void;
  /** Re-answer the prompt this assistant reply answered, as a sibling. */
  onRegenerate?: (message: ChatMessageView) => void;
  /** Fork the conversation up to this message into a visible new chat. */
  onFork?: (message: ChatMessageView) => void;
  /** "Read replies aloud" is on — fresh replies synthesize as they stream. */
  voiceEnabled?: boolean;
  /** The org can synthesize — gates the "Speak out loud" action. */
  speakAvailable?: boolean;
  /** Mount this message's voice pill regardless of voice mode — the arena
   * plays its combined round through one reply's player. */
  voicePillForced?: boolean;
  /** The message arrived live during this mount (not with the history). */
  isFreshSinceMount?: boolean;
}

function MessageItemComponent({
  message,
  isLast,
  isHistory,
  rootRef,
  organizationId,
  threadId,
  feedbackRating,
  forkGroup,
  onEditSubmit,
  onRegenerate,
  onFork,
  voiceEnabled,
  speakAvailable,
  voicePillForced,
  isFreshSinceMount,
}: MessageItemProps) {
  const { t } = useT('chat');
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  // A user stop is a clean terminal, not a policy event; a guardrail block
  // with no text SUBSTITUTES the content region (the reply never existed),
  // while a block on partial output annotates beneath what streamed.
  const stopped = isStoppedReason(message.blockedReason);
  const blockedSubstitutes =
    isAssistant &&
    message.blockedReason !== undefined &&
    !stopped &&
    message.text.length === 0;

  return (
    <li
      ref={rootRef}
      data-testid="chat-message"
      data-message-role={message.role}
      data-message-key={message.key}
      className={cn(
        'group/message flex min-w-0 flex-col',
        isUser ? 'items-end' : 'items-start',
        isHistory === true && HISTORY_CONTENT_VISIBILITY,
        rootRef !== undefined && 'scroll-mt-6',
      )}
    >
      {isUser ? (
        <UserBubble
          message={message}
          forkGroup={forkGroup}
          onEditSubmit={onEditSubmit}
        />
      ) : blockedSubstitutes ? (
        <BlockedNotice />
      ) : isAssistant ? (
        <AssistantBody
          message={message}
          isLast={isLast}
          organizationId={organizationId}
          threadId={threadId}
          feedbackRating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
          voiceEnabled={voiceEnabled}
          speakAvailable={speakAvailable}
          voicePillForced={voicePillForced}
          isFreshSinceMount={isFreshSinceMount}
        />
      ) : message.role === 'system' ? (
        <SystemNotice text={message.text} parts={message.parts} />
      ) : (
        <MessageParts parts={message.parts} />
      )}

      {stopped && (
        <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
          <CircleStop aria-hidden className="size-3.5 shrink-0" />
          {t('generationStopped')}
        </p>
      )}
      {message.blockedReason !== undefined &&
        !stopped &&
        !blockedSubstitutes && <BlockedNotice />}
      {message.error !== undefined && (
        <ChatErrorDisplay
          error={message.error}
          organizationId={organizationId}
          onRetry={
            isLast && isAssistant && onRegenerate !== undefined
              ? () => onRegenerate(message)
              : undefined
          }
        />
      )}
    </li>
  );
}

/**
 * The row memo: the identity seam upstream hands back the SAME item reference
 * unless a rendered field changed, so the first check settles almost every
 * row on a streamed tick. The remaining props are scalars or
 * identity-stabilized by the surface; `forkGroup` compares by identity
 * because its map rebuilds only on branch changes, never mid-stream.
 */
export const MessageItem = memo(
  MessageItemComponent,
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message &&
    prevProps.isLast === nextProps.isLast &&
    prevProps.isHistory === nextProps.isHistory &&
    prevProps.rootRef === nextProps.rootRef &&
    prevProps.organizationId === nextProps.organizationId &&
    prevProps.threadId === nextProps.threadId &&
    prevProps.feedbackRating === nextProps.feedbackRating &&
    prevProps.forkGroup === nextProps.forkGroup &&
    prevProps.onEditSubmit === nextProps.onEditSubmit &&
    prevProps.onRegenerate === nextProps.onRegenerate &&
    prevProps.onFork === nextProps.onFork &&
    prevProps.voiceEnabled === nextProps.voiceEnabled &&
    prevProps.speakAvailable === nextProps.speakAvailable &&
    prevProps.voicePillForced === nextProps.voicePillForced &&
    prevProps.isFreshSinceMount === nextProps.isFreshSinceMount,
);

/** The user's turn: a right-aligned bubble, clamped when it runs long, with
 * the edit affordance and the fork navigator underneath. */
function UserBubble({
  message,
  forkGroup,
  onEditSubmit,
}: {
  message: ChatMessageView;
  forkGroup?: MessageForkGroupView;
  onEditSubmit?: (message: ChatMessageView, text: string) => void;
}) {
  const { t } = useT('chat');
  const { formatDateHeader, formatDate } = useFormatDate();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [editing, setEditing] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // "Today, 14:32" / "Yesterday, 09:15" / a localized date + time — revealed
  // on hover alongside the edit affordance.
  const sentAt = new Date(message.createdAt);
  const sentLabel = `${formatDateHeader(sentAt)}, ${formatDate(sentAt, 'time')}`;

  // Measure the clamp only while clamped — once expanded, scrollHeight equals
  // clientHeight and would read as "fits", hiding the Show less toggle. The
  // ResizeObserver re-measures on container reflow (panel fold, window
  // resize): a bubble that fit at one width can overflow at another.
  useLayoutEffect(() => {
    if (expanded || editing) return undefined;
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, editing, message.parts]);

  if (editing) {
    return (
      <MessageEditForm
        initialText={messagePlainText(message.parts)}
        onSubmit={(text) => {
          setEditing(false);
          onEditSubmit?.(message, text);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex max-w-xs flex-col items-end lg:max-w-md">
      <div
        ref={bodyRef}
        className={cn(
          'bg-muted text-foreground rounded-2xl px-4 py-3 break-words',
          // ~16 lines of text-sm (the 0.3 clamp); longer collapses behind
          // Show more.
          !expanded && 'max-h-96 overflow-hidden',
        )}
      >
        <MessageParts parts={message.parts} />
      </div>
      <div className="flex items-center gap-0.5">
        <span className="text-muted-foreground/70 mt-1 text-xs opacity-0 transition-opacity group-hover/message:opacity-100 pointer-coarse:opacity-100">
          {sentLabel}
        </span>
        {(overflowing || expanded) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            className="text-muted-foreground mt-1 h-6 px-2 text-xs"
          >
            {expanded ? t('showLess') : t('showMore')}
          </Button>
        )}
        {onEditSubmit !== undefined && (
          <Button
            size="icon"
            variant="ghost"
            title={t('editMessage')}
            tooltipSide="bottom"
            data-testid="message-edit-button"
            onClick={() => setEditing(true)}
            className="text-muted-foreground mt-1 size-6 opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Pencil aria-hidden className="size-3" />
          </Button>
        )}
        {forkGroup !== undefined && (
          <BranchNavigator
            index={forkGroup.index}
            total={forkGroup.total}
            onSelect={forkGroup.onSelect}
          />
        )}
      </div>
    </div>
  );
}

/** The assistant's turn: full-width markdown, the voice pill when the reply
 * speaks, toolbar underneath. */
function AssistantBody({
  message,
  isLast,
  organizationId,
  threadId,
  feedbackRating,
  onRegenerate,
  onFork,
  voiceEnabled,
  speakAvailable,
  voicePillForced,
  isFreshSinceMount,
}: {
  message: ChatMessageItem;
  isLast: boolean;
  organizationId?: string;
  threadId?: string;
  feedbackRating?: 'positive' | 'negative';
  onRegenerate?: (message: ChatMessageView) => void;
  onFork?: (message: ChatMessageView) => void;
  voiceEnabled?: boolean;
  speakAvailable?: boolean;
  voicePillForced?: boolean;
  isFreshSinceMount?: boolean;
}) {
  const { t } = useT('chat');
  const { text, isStreaming } = message;
  const waitingForFirstToken = isStreaming && text.length === 0;
  // The pre-first-byte gap shows the 0.3 shell: dots plus the ticking
  // send-anchored "Thinking · Ns". The shell and the thought timeline are
  // MUTUALLY EXCLUSIVE — the moment the timeline has anything to show
  // (live reasoning, or settled reasoning/tool steps between rounds), its
  // header carries the one live indicator and the shell stays down; two
  // "Thinking" pulses on one reply read as a glitch. Same anchor on both,
  // so the handoff never jumps the count.
  const timelineHasContent =
    (message.reasoningText !== undefined && message.reasoningText.length > 0) ||
    message.parts.some(
      (part) =>
        // The SAME predicate the timeline draws by: a pausing tool has its own
        // row and is not a step, so counting it here would suppress the
        // thinking shell for a turn whose timeline renders nothing.
        (part.type === 'tool-call' && !isPausingChatTool(part.capabilityId)) ||
        (part.type === 'reasoning' && part.text.length > 0),
    );
  const inGapShell = waitingForFirstToken && !timelineHasContent;

  // Whether THIS mount watched the reply stream in: only then does the
  // toolbar earn its entrance animation — a settled row remounted by a
  // thread or branch switch renders its chrome statically, never re-fading.
  const sawLiveRevealRef = useRef(isStreaming);
  if (isStreaming) sawLiveRevealRef.current = true;

  // Manual select-and-copy of rendered markdown serializes a line break at
  // every block boundary; rewrite the clipboard only when normalization
  // actually changes the text so ordinary copies stay untouched.
  const handleCopySelection = (event: ClipboardEvent<HTMLDivElement>) => {
    const selection = document.getSelection()?.toString() ?? '';
    if (selection.length === 0) return;
    const normalized = normalizeCopiedText(selection);
    if (normalized === selection) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', normalized);
  };

  // The thinking timer's zero point: the send moment for a row born from
  // this client's optimistic send, the row's server start on reload. Memoized
  // on the row's identity facts so a streamed chunk never re-anchors it.
  const { toClientEpoch } = useClockOffset();
  const anchor = useMemo(
    () =>
      messageThinkingAnchor(
        { key: message.key, createdAt: message.createdAt },
        toClientEpoch,
      ),
    [message.key, message.createdAt, toClientEpoch],
  );
  const gapTimer = useThinkingTimer(anchor, inGapShell);

  // The toolbar waits for the REVEAL to finish, not just the stream: the
  // buffered typewriter keeps writing after the turn settles, and a toolbar
  // mounting mid-drain is pushed down by every revealed segment. History
  // rows mount settled and skip the wait.
  const [revealDone, setRevealDone] = useState(
    () => !message.isStreaming && !message.isFinalReveal,
  );
  const handleRevealComplete = useCallback(() => {
    window.setTimeout(() => setRevealDone(true), TOOLBAR_REVEAL_DELAY_MS);
  }, []);
  useEffect(() => {
    // Safety valve: a settled row whose reveal never reports completion (a
    // hidden tab froze the rAF loop) still gets its toolbar.
    if (revealDone || isStreaming) return undefined;
    const timer = window.setTimeout(
      () => setRevealDone(true),
      REVEAL_SAFETY_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [revealDone, isStreaming]);

  // Auto-voice: reads the reply aloud as it streams (fresh messages only —
  // the fresh gate keeps a revisited thread from re-reading history). The
  // hook renders nothing and idles unless enabled.
  useVoiceOutputChunker({
    enabled: voiceEnabled === true,
    messageId: message.id,
    threadId,
    organizationId,
    text,
    isStreaming,
    isFreshSinceMount: isFreshSinceMount === true,
  });
  // On-demand: the toolbar's "Speak out loud" for a settled reply.
  const onDemand = useOnDemandSpeech({
    messageId: message.id,
    threadId,
    organizationId,
    text,
  });
  // The voice pill mounts on every assistant row while voice mode is ON —
  // the 0.3 treatment: a history reply whose chunks were already synthesized
  // offers its idle Play chip for replay. The per-row chunk read is the
  // accepted cost of the mode; with voice off, only an explicit speak (or
  // the arena's forced pill) mounts one.
  const showVoicePill =
    voiceEnabled === true || voicePillForced === true || onDemand.requested;

  return (
    <div className="w-full min-w-0" onCopy={handleCopySelection}>
      {showVoicePill && (
        <VoiceOutputIndicator
          enabled
          messageId={message.id}
          threadId={threadId}
          isStreaming={isStreaming}
          isFreshSinceMount={isFreshSinceMount === true}
          organizationId={organizationId}
        />
      )}
      <ThoughtTimeline
        parts={message.parts}
        {...(message.reasoningText !== undefined
          ? { reasoningText: message.reasoningText }
          : {})}
        active={isStreaming && text.length === 0}
        isStreaming={isStreaming}
        {...(message.usage !== undefined ? { usage: message.usage } : {})}
        anchor={anchor}
      />
      {/* The tool loop spent its round budget — the answer below was forced
          with the investigation cut short; say so. */}
      {stepLimitHit(message.usage) && <StepLimitNotice />}
      {/* One persistent wrapper across the dots → text transition, so the
          swap never collapses the row's box. */}
      <div className="min-h-5 w-full min-w-0">
        {inGapShell ? (
          <span
            data-testid="thinking-gap-shell"
            className="flex h-5 items-center gap-2"
          >
            <ThinkingDots />
            {gapTimer.liveElapsedMs !== null && (
              <Text as="span" variant="muted" className="text-sm">
                {`${t('thinking.label')} · ${t('thinking.seconds', {
                  seconds: toSeconds(gapTimer.liveElapsedMs),
                })}`}
              </Text>
            )}
          </span>
        ) : isGenerationIncomplete(message) ? (
          <GenerationIncompleteNotice parts={message.parts} />
        ) : (
          <MessageMarkdown
            text={text}
            parts={message.parts}
            isStreaming={isStreaming}
            onRevealComplete={revealDone ? undefined : handleRevealComplete}
          />
        )}
      </div>
      {/* What this answer actually read — pages fetched, documents loaded —
          derived from the tool results, never from the prose. Settle-gated:
          the strip appears once (with its fade), never card-by-card while
          the user reads the streaming answer above it. */}
      {!isStreaming && (
        <SourceCards parts={message.parts} organizationId={organizationId} />
      )}
      {/* The toolbar arrives when the REVEAL settles — the live region below
          the transcript narrates the in-flight states — and, when this mount
          watched the reply stream in, enters with the same fade+lift the
          stream segments used. */}
      {!isStreaming && revealDone && (
        <MessageToolbar
          message={message}
          alwaysVisible={isLast}
          className={
            isLast && sawLiveRevealRef.current
              ? 'animate-toolbar-in'
              : undefined
          }
          organizationId={organizationId}
          threadId={threadId}
          rating={feedbackRating}
          onRegenerate={onRegenerate}
          onFork={onFork}
          onSpeak={
            speakAvailable === true &&
            threadId !== undefined &&
            organizationId !== undefined &&
            text.length > 0
              ? onDemand.speak
              : undefined
          }
        />
      )}
    </div>
  );
}
