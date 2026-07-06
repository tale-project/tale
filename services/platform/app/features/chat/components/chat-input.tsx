'use client';

import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { type SearchSource } from '@tale/ui/search';
import { Text } from '@tale/ui/text';
import type { ToastActionElement } from '@tale/ui/toast';
import { ArrowUp, CircleStop } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useCallback, useId, useRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import type { FileAttachment } from '../hooks/use-convex-file-upload';
import {
  detectMentionTrigger,
  MAX_KB_MENTIONS,
  type KbMention,
  type MentionTrigger,
} from '../hooks/use-kb-mentions';
import { useVideoUrlIngest } from '../hooks/use-video-url-ingest';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import {
  ActorMentionPopover,
  type ActorMentionData,
} from './actor-mention-popover';
import { AgentSelector } from './agent-selector';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaModelSelector } from './arena/arena-model-selector';
import { AttachmentTray } from './chat-input/attachment-tray';
import { toBcp47 } from './chat-input/locale-defaults';
import {
  PasteImageOverlay,
  type PasteImageChip,
} from './chat-input/paste-image-overlay';
import {
  buildMarkerToken,
  collapseMarkerSpaces,
  nextPasteImageId,
  pastedImageIdFromName,
  tokenSpans,
} from './chat-input/paste-image-tokens';
import { ComposerCapabilityPills } from './composer-capability-pills';
import { ComposerModeMenu } from './composer-mode-menu';
import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';
import { createDocumentsMentionSource } from './documents-mention-source';
import { ExternalAgentModeToggle } from './external-agent-mode-toggle';
import { KbMentionPopover } from './kb-mention-popover';
import { ImagePreviewDialog } from './message-bubble';
import { ModelSelector } from './model-selector';
import { QuotedReferenceChip } from './quoted-reference-chip';
import { SandboxStateIndicator } from './sandbox-state-indicator';
import { SavePromptMenu } from './save-prompt-menu';
import { VideoLinkChip } from './video-link-chip';
import { VoiceModeToggle } from './voice-mode-toggle';

/** Stable no-op fallback so ChatInput can call the actor-mention source
 *  unconditionally (keeping hook order fixed) when no source is provided — i.e.
 *  in 1:1 chat, which uses the knowledge-base picker instead. */
const EMPTY_ACTOR_MENTION_SOURCE: SearchSource<ActorMentionData> = () => ({
  results: [],
  status: 'idle',
});

interface ChatInputProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> {
  onSendMessage: (
    message: string,
    attachments?: FileAttachment[],
    kbReferences?: KbMention[],
  ) => void;
  onStopGenerating?: () => void;
  isLoading?: boolean;
  /**
   * Queue mode (external-agent threads with a running turn): the textarea
   * stays usable while `isLoading` — sends enqueue for the running agent.
   * The send button keeps its send identity and a separate Stop control
   * renders next to it. Attachments / dictation / voice / `@`-mentions stay
   * blocked (queue sends are text-only in v1).
   */
  queueModeActive?: boolean;
  disabled?: boolean;
  disabledReason?: 'no-agents' | 'pending-approval' | 'archived';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  organizationId: string;
  /** Active thread id — drives the composer voice-mode toggle (per-thread). */
  threadId?: string;
  attachments: FileAttachment[];
  uploadingFiles: string[];
  uploadFiles: (files: File[]) => Promise<void>;
  cancelUpload?: (fileId: string) => void;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  clearAttachments: () => FileAttachment[];
  fileUploadDisabled?: boolean;
  isIndexing?: boolean;
  indexingStatuses?: Map<
    Id<'_storage'>,
    { status?: string; error?: string; progress?: string }
  >;
  /** True while any audio attachment is still `queued` or `running`, or the
   * transcription-status query is still resolving. Blocks send so the LLM
   * never sees a "pending" transcript. */
  isTranscribing?: boolean;
  transcriptionStatuses?: Map<
    Id<'_storage'>,
    {
      status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
      error?: string;
      progress?: string;
      transcript?: string;
      durationSec?: number;
      ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
      ragError?: string;
    }
  >;
  /** True when any audio attachment's transcription terminally `failed`.
   * Blocks send so the user retries or removes it first — mirrors
   * `hasFailedVideoJobs`. */
  hasFailedAudioJobs?: boolean;
  /** Re-run a failed audio transcription (reuses the persisted `_storage`
   * blob; no re-upload). Wired to the retry button on the audio chip. */
  retryAudioTranscription?: (fileId: Id<'_storage'>) => void;
  onSavePrompt?: (content: string) => void;
  onOpenPromptLibrary?: () => void;
  /**
   * Video-link chip state (from `useChatVideoLinks`). When a user pastes
   * a video URL the hook's mutation creates a row in `videoLinkJobs`
   * and the orchestrator action drives it through captions or Whisper.
   * Chips render in the attachment area; send is gated while any chip
   * is still processing — mirrors `isTranscribing` for audio uploads.
   */
  videoLinkJobs?: VideoLinkJob[];
  isProcessingVideo?: boolean;
  /** True when any video-link chip is in a terminal `failed` state. Send
   * is blocked while this is set so the user explicitly retries / removes
   * the failed chip — otherwise the message ships without that transcript
   * and the agent replies to the raw URL, which reads as "the AI ignored
   * my video" (round-2 V10 / HIGH #18). */
  hasFailedVideoJobs?: boolean;
  ingestVideoUrlsFromText?: (
    text: string,
    organizationId: string,
    userLocale?: string,
  ) => Promise<number>;
  cancelVideoJob?: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  retryVideoJob?: (jobId: Id<'videoLinkJobs'>) => Promise<void>;
  /**
   * When true, the send button is disabled. Unlike `disabled`, the input
   * itself stays editable so the user can still revise their message — they
   * just can't send it in the current state (e.g. an edit reference is
   * attached but the selected model doesn't support editing). Pair with a
   * visible reason (e.g. the EditingBanner) so it isn't mysterious.
   */
  /** Project the chat belongs to (if any) — restricts the agent/model pickers
   *  to the project's allowed agents/models and surfaces its recommendations. */
  projectId?: string;
  sendBlocked?: boolean;
  /** Tooltip shown on the send button when `sendBlocked` is true. */
  sendBlockedReason?: string;
  /**
   * Optional action for the send-blocked toast — only set for the actionable
   * missing-API-key subcase (a deep link to provider settings). The generic
   * blocked-reason toast carries none.
   */
  sendBlockedAction?: ToastActionElement;
  /** Optional secondary line for the send-blocked toast (e.g. an admin hint). */
  sendBlockedDescription?: string;
  /**
   * Fired when the composer becomes active (focus). Used to pre-warm the prompt
   * cache so the next message is served warm. Best-effort and debounced by the
   * caller; safe to omit.
   */
  onComposerActivate?: () => void;
  /**
   * `@`-mention knowledge-base references (from `useKbMentions`, owned by the
   * caller so a failed send can restore the chips). The picker only renders
   * when ALL four are provided — surfaces without the feature (shared chat
   * view, automation assistant) simply omit them. Hidden in arena mode.
   */
  kbMentions?: KbMention[];
  addKbMention?: (mention: KbMention) => boolean;
  removeKbMention?: (documentId: Id<'documents'>) => void;
  clearKbMentions?: () => KbMention[];
  /**
   * Optional `@`-mention source for plain-text actor handles (teammates +
   * agents), used by multi-party surfaces (Discussions). When provided it
   * REPLACES the knowledge-base picker: selecting inserts `@handle ` prose (no
   * chip, no id) — the discussion backend re-parses the body. 1:1 chat omits it
   * and keeps the KB-document picker. Hidden in arena mode.
   */
  actorMentionSource?: SearchSource<ActorMentionData>;
  /**
   * Which composer controls to render. `'full'` (default) is the main chat.
   * `'assistant'` is the editor AI panels (the automations editor), where
   * the agent is pinned server-side — the agent/model pickers, capability
   * pills (image generation etc.) and the voice-mode toggle would be
   * decorative at best and misleading at worst, so they're hidden.
   * Attachments, dictation and send stay.
   */
  variant?: 'full' | 'assistant';
}

/**
 * Media-processing states that block sending, in send-button-tooltip
 * precedence order; each maps to its `chat` i18n tooltip key.
 */
type MediaBlockReason =
  | 'transcribing'
  | 'processingVideo'
  | 'failedVideo'
  | 'failedAudio';

const MEDIA_BLOCK_TOOLTIP_KEY: Record<MediaBlockReason, string> = {
  transcribing: 'transcription.inProgressTooltip',
  processingVideo: 'videoLink.chip.inProgressTooltip',
  failedVideo: 'videoLink.chip.failedSendBlockedTooltip',
  failedAudio: 'transcription.failedSendBlockedTooltip',
};

export function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  onStopGenerating,
  isLoading = false,
  queueModeActive = false,
  disabled = false,
  disabledReason,
  placeholder,
  organizationId,
  threadId,
  attachments,
  uploadingFiles,
  uploadFiles,
  cancelUpload,
  removeAttachment,
  clearAttachments,
  fileUploadDisabled = false,
  isIndexing = false,
  indexingStatuses,
  isTranscribing = false,
  transcriptionStatuses,
  hasFailedAudioJobs = false,
  retryAudioTranscription,
  videoLinkJobs = [],
  isProcessingVideo = false,
  hasFailedVideoJobs = false,
  ingestVideoUrlsFromText,
  cancelVideoJob,
  retryVideoJob,
  onSavePrompt,
  onOpenPromptLibrary,
  projectId,
  sendBlocked = false,
  sendBlockedReason,
  sendBlockedAction,
  sendBlockedDescription,
  onComposerActivate,
  kbMentions,
  addKbMention,
  removeKbMention,
  clearKbMentions,
  actorMentionSource,
  variant = 'full',
  ...restProps
}: ChatInputProps) {
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');
  const { t: tComposer } = useT('composer');
  const { i18n } = useTranslation();
  const arenaContext = useArenaModeOptional();
  const isArenaMode = arenaContext?.isArenaMode ?? false;

  const speechLang = toBcp47(i18n.language) ?? 'en-US';
  const policyLimits = useUploadPolicy(organizationId);
  const effectiveAccept = useMemo(() => {
    if (
      !policyLimits.policyEnabled ||
      policyLimits.allowedExtensions.length === 0
    ) {
      return CHAT_UPLOAD_ACCEPT;
    }
    return policyLimits.allowedExtensions.map((ext) => `.${ext}`).join(',');
  }, [policyLimits]);

  const textareaId = useId();
  const textareaLabelId = `${textareaId}-label`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionAnchorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationRef = useRef<DictationButtonHandle>(null);
  // True while a CJK IME (Chinese / Japanese / Korean) is composing a
  // pre-commit string. Cross-browser fallback for
  // `e.nativeEvent.isComposing`, which not every browser surfaces on the
  // paste event itself. Blocks `handlePaste` and the chip-cancel strip
  // path so we don't mutate the textarea while an IME commit is in
  // flight (round-2 V10 / HIGH #19).
  const isComposingRef = useRef(false);
  // A pasted/dropped video URL ingests fire-and-forget; `pasteIngestPending`
  // lets the send-gate block a paste-then-Enter race until the chip row lands
  // (round-2 V10 / HIGH #23). Shared by the paste + drag-drop handlers below.
  const { pending: pasteIngestPending, ingest: ingestVideoUrls } =
    useVideoUrlIngest(ingestVideoUrlsFromText, organizationId, i18n.language);

  // Single source of truth for the media-processing states that block send.
  // `mediaBlockReason` names the active one (precedence order) for the send-
  // button tooltip; `mediaBlocksSend` is the OR consumed by the send-gate and
  // the disabled state. `pasteIngestPending` (blocks send, no tooltip) and
  // `sendBlocked` (carries its own reason string) stay separate.
  const mediaBlockReason: MediaBlockReason | null = isTranscribing
    ? 'transcribing'
    : isProcessingVideo
      ? 'processingVideo'
      : hasFailedVideoJobs
        ? 'failedVideo'
        : hasFailedAudioJobs
          ? 'failedAudio'
          : null;
  const mediaBlocksSend = mediaBlockReason !== null;
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [previewTranscript, setPreviewTranscript] = useState<{
    fileName: string;
    transcript: string;
    durationSec?: number;
  } | null>(null);
  const defaultPlaceholder = placeholder || tChat('typeMessageHere');
  const sendBlockedVisible = sendBlocked && sendBlockedReason && !isLoading;

  const isUploading = uploadingFiles.length > 0;
  // Queue mode keeps the textarea usable during a running turn; non-text
  // affordances (attachments, dictation, voice, `@`-mentions) keep the old
  // "blocked while loading" gate — queue sends are text-only in v1.
  const attachDisabled = disabled || isLoading;
  const inputDisabled = disabled || (isLoading && !queueModeActive);

  const { quotedText, setQuotedText } = useChatLayout();

  // ---- `@` knowledge-base mention picker -------------------------------
  // Enabled only when the caller wires the full mention contract (chips are
  // the source of truth and live with the caller for send-failure rollback).
  // Hidden in arena mode — referencedDocumentIds is not wired through
  // arena_chat in v1.
  const kbMentionsEnabled =
    !isArenaMode &&
    !!kbMentions &&
    !!addKbMention &&
    !!removeKbMention &&
    !!clearKbMentions;
  // Multi-party surfaces (Discussions) wire an actor source instead of the KB
  // contract. The two are mutually exclusive by construction: `mentionsEnabled`
  // gates the SHARED trigger/keyboard/aria machinery, while each source
  // self-gates on its own flag so the inactive one never fires.
  const actorMentionsEnabled = !isArenaMode && !!actorMentionSource;
  const mentionsEnabled = kbMentionsEnabled || actorMentionsEnabled;
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(
    null,
  );
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const mentionListboxId = `${textareaId}-kb-mentions`;
  const mentionPickerOpen =
    mentionsEnabled && mentionTrigger !== null && !attachDisabled;

  // SearchSource contract: stable identity, called unconditionally every
  // render (it is a hook); inactive renders pass 'skip' to Convex.
  const mentionSource = useMemo(
    () => createDocumentsMentionSource({ organizationId }),
    [organizationId],
  );
  const kbMentionState = mentionSource(mentionTrigger?.query ?? '', {
    active: mentionPickerOpen && kbMentionsEnabled,
    open: mentionPickerOpen && kbMentionsEnabled,
  });
  // Called unconditionally via a stable no-op fallback so hook order is fixed
  // per instance (the real source runs hooks; the fallback runs none).
  const actorMentionState = (actorMentionSource ?? EMPTY_ACTOR_MENTION_SOURCE)(
    mentionTrigger?.query ?? '',
    {
      active: mentionPickerOpen && actorMentionsEnabled,
      open: mentionPickerOpen && actorMentionsEnabled,
    },
  );
  const kbMentionResults = useMemo(
    () => kbMentionState.results.slice(0, 8),
    [kbMentionState.results],
  );
  const actorMentionResults = useMemo(
    () => actorMentionState.results.slice(0, 8),
    [actorMentionState.results],
  );
  const mentionResults = actorMentionsEnabled
    ? actorMentionResults
    : kbMentionResults;
  const clampedMentionHighlight = Math.min(
    mentionHighlight,
    Math.max(mentionResults.length - 1, 0),
  );

  /**
   * Re-evaluate the `@` trigger from the current caret. `onlyWhenOpen`
   * restricts caret-move events (clicks, arrows) to UPDATING/CLOSING an open
   * picker — only typing opens it, so clicking into previously inserted
   * "@Title" prose doesn't pop the picker back up.
   */
  const updateMentionTrigger = useCallback(
    (onlyWhenOpen: boolean) => {
      if (!mentionsEnabled) return;
      const textarea = textareaRef.current;
      if (!textarea) return;
      const next = detectMentionTrigger(
        textarea.value,
        textarea.selectionStart ?? textarea.value.length,
      );
      setMentionTrigger((prev) => {
        if (onlyWhenOpen && prev === null) return prev;
        if (
          prev &&
          next &&
          prev.query === next.query &&
          prev.start === next.start &&
          prev.end === next.end
        ) {
          return prev;
        }
        if (prev === null || next === null || prev.query !== next.query) {
          setMentionHighlight(0);
        }
        return next;
      });
    },
    [mentionsEnabled],
  );

  const handleSelectMention = useCallback(
    (selected: KbMention | ActorMentionData) => {
      const trigger = mentionTrigger;
      if (!trigger) return;
      const textarea = textareaRef.current;
      // Replace the typed `@query` with `@text ` prose. `setRangeText` on the
      // DOM node keeps the caret + undo stack intact (same rationale as the
      // video-link chip strip path below); the no-node branch is the
      // controlled fallback.
      const insertAtTrigger = (insertion: string) => {
        if (textarea) {
          textarea.setRangeText(insertion, trigger.start, trigger.end, 'end');
          onChange?.(textarea.value);
        } else {
          onChange?.(
            value.slice(0, trigger.start) +
              insertion +
              value.slice(trigger.end),
          );
        }
        setMentionTrigger(null);
        setMentionHighlight(0);
      };

      // Actor mention (Discussions): insert plain `@handle ` — no chip; the
      // discussion backend re-parses the body server-side.
      if ('handle' in selected) {
        if (actorMentionsEnabled) insertAtTrigger(`@${selected.handle} `);
        return;
      }

      // Knowledge-base mention (1:1 chat): owns a chip via addKbMention.
      if (!kbMentionsEnabled) return;
      const added = addKbMention?.(selected) ?? false;
      if (!added) {
        toast({
          title: tComposer('kbMention.limitReached', {
            max: MAX_KB_MENTIONS,
          }),
          variant: 'destructive',
        });
        setMentionTrigger(null);
        return;
      }
      insertAtTrigger(`@${selected.title} `);
    },
    [
      mentionTrigger,
      actorMentionsEnabled,
      kbMentionsEnabled,
      addKbMention,
      onChange,
      value,
      tComposer,
    ],
  );

  const handleSendMessage = () => {
    // When the user clearly intends to send (there's content) but the send is
    // blocked for a stated reason, surface it. The disabled send button shows
    // this as a hover tooltip, but a keyboard Enter would otherwise be a silent
    // no-op — which reads as "Enter doesn't work" (most often the selected
    // model's provider has no API key).
    const hasInput = !!value.trim() || attachments.length > 0;
    if (hasInput && !isLoading && sendBlocked && sendBlockedReason) {
      toast({
        title: sendBlockedReason,
        description: sendBlockedDescription,
        action: sendBlockedAction,
        variant: 'destructive',
      });
      return;
    }

    // Queue mode: text-only enqueue while the turn runs. Attachments staged
    // before the turn started stay in the composer for the next normal send.
    const queueSend = queueModeActive && isLoading;
    if (
      (!value.trim() && attachments.length === 0) ||
      (isLoading && !queueModeActive) ||
      (queueSend && (!value.trim() || attachments.length > 0)) ||
      disabled ||
      isUploading ||
      isIndexing ||
      mediaBlocksSend ||
      pasteIngestPending ||
      sendBlocked
    )
      return;

    if (queueSend) {
      // Plain-text path: no attachment/KB-chip consumption — those stay for
      // the next normal send. Quote prefix still applies.
      const trimmedQueue = value.trim();
      const queueMessage = quotedText
        ? `> ${quotedText.replace(/\n/g, '\n> ')}\n\n${trimmedQueue}`
        : trimmedQueue;
      if (quotedText) setQuotedText(null);
      dictationRef.current?.stop();
      onSendMessage(queueMessage);
      return;
    }

    const attachmentsToSend =
      attachments.length > 0 ? clearAttachments() : undefined;

    // Prepend any staged quote as a markdown blockquote so the model sees
    // the referenced passage above the user's message, then clear it. The
    // `[N]` markers ride along (positional reference for the agent); their
    // reserve spaces collapse to one so the sent text stays clean.
    const trimmed = collapseMarkerSpaces(value).trim();
    const messageToSend = quotedText
      ? `> ${quotedText.replace(/\n/g, '\n> ')}\n\n${trimmed}`
      : trimmed;
    if (quotedText) setQuotedText(null);

    // Stop any in-progress dictation so the mic doesn't keep recording after
    // the message is sent (#1462).
    dictationRef.current?.stop();

    // Hand the pinned KB references over with the message; the caller owns
    // the snapshot for send-failure rollback (mirrors clearAttachments).
    const kbRefsToSend =
      kbMentionsEnabled && kbMentions && kbMentions.length > 0
        ? clearKbMentions?.()
        : undefined;
    setMentionTrigger(null);

    onSendMessage(messageToSend, attachmentsToSend, kbRefsToSend);
  };

  const imageAttachments = useMemo(
    () => attachments.filter((att) => att.fileType.startsWith('image/')),
    [attachments],
  );

  const fileAttachments = useMemo(
    () => attachments.filter((att) => !att.fileType.startsWith('image/')),
    [attachments],
  );

  // Chip data per image id, derived purely from the live attachments + uploads
  // — the marker is independent of the image (deleting a `[N]` keeps the
  // attachment, and vice-versa). An id present here means a `[N]` token refers
  // to a real image, which also gates atomic marker deletion below.
  const pasteChips = useMemo(() => {
    const map = new Map<number, PasteImageChip>();
    for (const id of uploadingFiles) {
      const tokenId = pastedImageIdFromName(id);
      if (tokenId !== null) map.set(tokenId, { status: 'uploading' });
    }
    for (const att of attachments) {
      const tokenId = pastedImageIdFromName(att.fileName);
      if (tokenId !== null && att.fileType.startsWith('image/')) {
        map.set(tokenId, { status: 'ready', previewUrl: att.previewUrl });
      }
    }
    return map;
  }, [attachments, uploadingFiles]);

  // Clicking an inline `[N]` chip opens the same preview dialog as its tray
  // thumbnail (the chip mirrors the tray, it doesn't replace it).
  const openPastedImage = useCallback(
    (id: number) => {
      const att = attachments.find(
        (a) => pastedImageIdFromName(a.fileName) === id,
      );
      if (att?.previewUrl) {
        setPreviewImage({ src: att.previewUrl, alt: att.fileName });
      }
    },
    [attachments],
  );

  // Removing an image from the tray also strips its inline `[N]` marker, so a
  // removed image never leaves an orphan token behind. (Deleting the marker
  // alone keeps the image — see deletePastedTokenAtCaret.)
  const handleRemoveAttachment = useCallback(
    (fileId: Id<'_storage'>) => {
      const att = attachments.find((a) => a.fileId === fileId);
      const id = att ? pastedImageIdFromName(att.fileName) : null;
      if (id !== null && onChange) {
        const span = tokenSpans(value).find((s) => s.id === id);
        if (span) {
          let end = span.end;
          while (value[end] === ' ') end += 1;
          onChange(value.slice(0, span.start) + value.slice(end));
        }
      }
      removeAttachment(fileId);
    },
    [attachments, value, onChange, removeAttachment],
  );

  // Insert `[N]` marker(s) (each with reserve spaces for the chip) at the
  // caret. Shared by paste and the drag-from-tray drop below.
  const insertMarkersAtCaret = (ids: number[]) => {
    const textarea = textareaRef.current;
    if (!textarea || !onChange || ids.length === 0) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const tokenText = lead + ids.map(buildMarkerToken).join('');
    textarea.setRangeText(tokenText, start, end, 'end');
    onChange(textarea.value);
  };

  // Drag a tray image into the composer to drop its `[N]` marker. The tray
  // thumbnail puts its id on the drag in this custom type; we move the caret to
  // the drop point (best-effort) and insert the marker there.
  const handleMarkerDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-tale-marker-id')) {
      e.preventDefault();
      e.stopPropagation(); // suppress the FileUpload drop overlay over the input
    }
  };
  const handleMarkerDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-tale-marker-id');
    if (!raw) return; // not a marker drag — let the file DropZone handle it
    const id = Number(raw);
    if (!Number.isInteger(id)) return;
    e.preventDefault();
    e.stopPropagation();
    const ta = textareaRef.current;
    if (ta) {
      const doc = document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
        ) => { offsetNode: Node; offset: number } | null;
      };
      const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (pos && (pos.offsetNode === ta || ta.contains(pos.offsetNode))) {
        ta.setSelectionRange(pos.offset, pos.offset);
      }
      ta.focus();
    }
    insertMarkersAtCaret([id]);
  };

  const handleInputChange = (newValue: string) => {
    onChange?.(newValue);
    // Typing both opens and closes the `@` picker (caret-move events only
    // update/close it — see updateMentionTrigger). Runs after onChange so the
    // textarea's value + caret reflect this keystroke.
    updateMentionTrigger(false);
  };

  const handleTranscript = useCallback(
    (transcript: string) => {
      const separator = value.length > 0 && !value.endsWith(' ') ? ' ' : '';
      onChange?.(value + separator + transcript);
    },
    [value, onChange],
  );

  // Treat a `[N]` marker as a single atomic unit when deleting: a plain
  // Backspace at the end of `[1]` would otherwise erase only `]` and leave a
  // dangling `[1`. When the caret sits inside/adjacent to a marker, wipe the
  // whole token plus its reserve spaces. Deleting a marker only removes the
  // marker — the image stays in the tray. Returns true when it handled the key.
  const deletePastedTokenAtCaret = (
    e: React.KeyboardEvent,
    direction: 'back' | 'forward',
  ): boolean => {
    if (pasteChips.size === 0) return false;
    const ta = textareaRef.current;
    if (
      !ta ||
      ta.selectionStart === null ||
      ta.selectionStart !== ta.selectionEnd
    ) {
      return false;
    }
    const caret = ta.selectionStart;
    const span = tokenSpans(ta.value).find(
      (s) =>
        pasteChips.has(s.id) &&
        (direction === 'back'
          ? s.start < caret && caret <= s.end
          : s.start <= caret && caret < s.end),
    );
    if (!span) return false;
    e.preventDefault();
    let end = span.end;
    while (ta.value[end] === ' ') end += 1; // consume the reserve spaces
    ta.setRangeText('', span.start, end, 'end');
    onChange?.(ta.value);
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME composition guard. macOS Pinyin / Japanese Kotoeri commits a
    // candidate via Enter; without these checks the textarea swallows
    // the commit and sends the half-composed romaji. `isComposing` is
    // the modern WHATWG API, `isComposingRef.current` is our React
    // mirror (composition events arrive on the DOM but React's
    // synthetic event types don't expose `isComposing`), and
    // `keyCode === 229` is the legacy Safari path. All three are
    // necessary to cover Chromium + WebKit + Firefox. The guard also
    // covers the mention-picker keys below — an IME commit must never
    // select a mention.
    const isComposing =
      e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229;

    // `@` mention picker navigation — intercepted while open so the caret
    // stays put and Enter selects instead of sending.
    if (mentionPickerOpen && !isComposing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionHighlight((i) =>
          Math.min(i + 1, Math.max(mentionResults.length - 1, 0)),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionHighlight((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionTrigger(null);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const selected = mentionResults[clampedMentionHighlight]?.data;
        if (selected) {
          handleSelectMention(selected);
          return;
        }
        // "No matches" empty state: swallow Enter/Tab and dismiss the picker
        // so it never falls through to send the literal `@query` (#2346). A
        // second Enter then sends, matching the picker-closed behaviour.
        setMentionTrigger(null);
        return;
      }
    }

    // Atomic marker deletion (runs before the textarea's default edit so a
    // Backspace can't shave a `[1]` token down to a dangling `[1`).
    if (!isComposing) {
      if (e.key === 'Backspace' && deletePastedTokenAtCaret(e, 'back')) return;
      if (e.key === 'Delete' && deletePastedTokenAtCaret(e, 'forward')) return;
    }

    if (e.key !== 'Enter' || e.shiftKey) return;
    if (isComposing) return;
    e.preventDefault();
    handleSendMessage();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    // attachDisabled (not inputDisabled): pasting in queue mode types plain
    // text only — no file/video-link ingest into a turn-in-flight composer.
    if (attachDisabled || fileUploadDisabled) return;
    // Bail when an IME composition is mid-flight. The paste handler would
    // otherwise enqueue an ingest mutation AND the chip-cancel strip path
    // could later `value.replace(token, '')` while the IME is still
    // committing characters — corrupting the commit buffer.
    // React typing gap: the DOM ClipboardEvent has an `isComposing` flag
    // but React's synthetic ClipboardEvent typings omit it. The runtime
    // value is present on every Chromium/WebKit/Firefox; the cast
    // surfaces it without a wider type widening that would let other
    // missing fields slip through.
    const nativeClipboard = e.nativeEvent as ClipboardEvent & {
      isComposing?: boolean;
    };
    if (isComposingRef.current || nativeClipboard.isComposing === true) {
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;

    // Name each pasted image `[N].<ext>`, where N is one past the highest `[N]`
    // already in the text — so numbering restarts at 1 once a send clears the
    // composer and never collides with a token the user typed.
    const imageFiles: File[] = [];
    const newImageIds: number[] = [];
    let nextId = nextPasteImageId(textareaRef.current?.value ?? value);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const extension = item.type.split('/')[1] || 'png';
          const id = nextId++;
          newImageIds.push(id);
          imageFiles.push(
            new File([file], `[${id}].${extension}`, { type: file.type }),
          );
        }
      }
    }

    if (imageFiles.length > 0) {
      // A pasted image is represented by its `[N]` marker, inserted
      // programmatically below. Clipboards frequently ship a text/alt or URL
      // fallback ALONGSIDE the image bytes, so prevent the native text paste
      // (and skip the text-normalize path) — otherwise that fallback inserts
      // on top of the marker and the message double-ups.
      e.preventDefault();
      // Drop a `[N]` reference marker at the caret so the image has a position
      // in the message; the overlay paints a thumbnail badge over it and the
      // agent sees `[N]` in the prose next to the `[N].ext` attachment.
      insertMarkersAtCaret(newImageIds);
      void uploadFiles(imageFiles);
      return;
    }

    // Video-link detection. Read both text/plain and text/html (rich-
    // clipboard sources like Notion/Slack ship only HTML). Don't
    // preventDefault — URL stays in the textarea so the user can edit
    // it; the strip-on-send mutation removes it before chatWithAgent.
    if (ingestVideoUrlsFromText) {
      const plain = e.clipboardData?.getData('text/plain') ?? '';
      const html = plain ? '' : (e.clipboardData?.getData('text/html') ?? '');
      const text =
        plain ||
        // Cheap href extraction from rich clipboard. Full HTML parsing
        // is overkill — we just need the URL chunks. Accept both
        // double-quoted and single-quoted href forms (Slack/Notion ship
        // double, some older email clients ship single).
        html.match(/href=["']([^"']+)["']/g)?.join(' ') ||
        '';
      ingestVideoUrls(text);
    }

    // Normalize the pasted text: collapse the blank-line stacks that copying
    // rendered chat markdown leaves behind, and trim. Only override the native
    // paste when normalization actually changes the text, so ordinary pastes
    // keep their caret + undo behavior. Runs after the video-link ingest above
    // (which only reads the clipboard); the URL survives the rewrite, so the
    // strip-on-send path is unaffected.
    const plainText = e.clipboardData?.getData('text/plain') ?? '';
    if (plainText && onChange) {
      const normalized = normalizeCopiedText(plainText);
      const textarea = textareaRef.current;
      if (normalized !== plainText && textarea) {
        e.preventDefault();
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.setRangeText(normalized, start, end, 'end');
        // setRangeText fires `input` but not `change` on some browsers —
        // propagate explicitly so the controlled value stays in sync.
        onChange(textarea.value);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

  return (
    <div {...restProps} className={cn(restProps.className)}>
      <FileUpload.DropZone
        className="relative flex h-full min-h-0 flex-1 flex-col"
        onFilesSelected={uploadFiles}
        onTextDrop={ingestVideoUrlsFromText ? ingestVideoUrls : undefined}
        clickable={false}
        disabled={attachDisabled || fileUploadDisabled}
      >
        <FileUpload.Overlay className="mx-2 rounded-t-3xl" />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={effectiveAccept}
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
        />

        {/* Soft top shadow lifts the composer off the conversation above it. */}
        <Stack
          gap={2}
          className="border-border sm:border-muted-foreground/50 relative mb-2 rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]"
        >
          {videoLinkJobs.length > 0 && (
            <HStack gap={1} wrap className="mb-2">
              {videoLinkJobs.map((job) => (
                <VideoLinkChip
                  key={job.jobId}
                  job={job}
                  onCancel={() => {
                    // Strip the user's pasted URL from the textarea
                    // BEFORE firing the cancel mutation, so the chip
                    // and the raw URL disappear together. Literal
                    // replace per the B1 review (regex over arbitrary
                    // URL shapes is fragile). No-op if the user edited
                    // the URL out manually. Use `setRangeText` on the
                    // DOM node so the caret position and undo stack
                    // survive — `onChange(stripped)` would otherwise
                    // jump the caret to the end and clobber any active
                    // selection.
                    if (isComposingRef.current) {
                      // Don't mutate the value mid-IME-commit; defer.
                      if (cancelVideoJob) void cancelVideoJob(job.jobId);
                      return;
                    }
                    if (
                      onChange &&
                      job.pastedToken &&
                      value.includes(job.pastedToken)
                    ) {
                      const idx = value.indexOf(job.pastedToken);
                      const textarea = textareaRef.current;
                      if (textarea && idx >= 0) {
                        textarea.setRangeText(
                          '',
                          idx,
                          idx + job.pastedToken.length,
                          'preserve',
                        );
                        // setRangeText fires `input` but not `change` on
                        // some browsers — propagate explicitly so React
                        // controlled-input state stays in sync.
                        onChange(textarea.value);
                      } else {
                        // Fallback when the ref isn't attached (e.g.
                        // chip rendered before textarea mounted).
                        onChange(value.replace(job.pastedToken, ''));
                      }
                    }
                    if (cancelVideoJob) void cancelVideoJob(job.jobId);
                  }}
                  onRetry={() =>
                    retryVideoJob ? void retryVideoJob(job.jobId) : undefined
                  }
                />
              ))}
            </HStack>
          )}
          {(attachments.length > 0 ||
            uploadingFiles.length > 0 ||
            (kbMentionsEnabled && (kbMentions?.length ?? 0) > 0)) && (
            <AttachmentTray
              kbMentionsEnabled={kbMentionsEnabled}
              kbMentions={kbMentions}
              removeKbMention={removeKbMention}
              imageAttachments={imageAttachments}
              fileAttachments={fileAttachments}
              uploadingFiles={uploadingFiles}
              transcriptionStatuses={transcriptionStatuses}
              indexingStatuses={indexingStatuses}
              retryAudioTranscription={retryAudioTranscription}
              cancelUpload={cancelUpload}
              removeAttachment={handleRemoveAttachment}
              onPreviewImage={setPreviewImage}
              onPreviewTranscript={setPreviewTranscript}
            />
          )}

          <QuotedReferenceChip />

          <div className="relative" ref={mentionAnchorRef}>
            {mentionPickerOpen && mentionTrigger && actorMentionsEnabled && (
              <ActorMentionPopover
                anchorRef={mentionAnchorRef}
                open={mentionPickerOpen}
                results={actorMentionResults}
                highlightedIndex={clampedMentionHighlight}
                onHighlight={setMentionHighlight}
                onSelect={handleSelectMention}
                listboxId={mentionListboxId}
                optionId={(index) => `${mentionListboxId}-option-${index}`}
              />
            )}
            {mentionPickerOpen && mentionTrigger && !actorMentionsEnabled && (
              <KbMentionPopover
                anchorRef={mentionAnchorRef}
                open={mentionPickerOpen}
                results={kbMentionResults}
                status={kbMentionState.status}
                query={mentionTrigger.query}
                highlightedIndex={clampedMentionHighlight}
                onHighlight={setMentionHighlight}
                onSelect={handleSelectMention}
                listboxId={mentionListboxId}
                optionId={(index) => `${mentionListboxId}-option-${index}`}
              />
            )}
            {/* A blocked send must say so where the user is looking: the
                disabled button's tooltip and the Enter toast are invisible
                until interacted with, which read as "the app is dead" on a
                fresh install with no provider key. */}
            {sendBlockedVisible && value.length > 0 && (
              <p role="status" className="text-destructive px-1 pb-1 text-xs">
                {sendBlockedReason}
              </p>
            )}
            <label
              id={textareaLabelId}
              htmlFor={textareaId}
              className="sr-only"
            >
              {tChat('aria.chatInput')}
            </label>
            <Textarea
              id={textareaId}
              ref={textareaRef}
              value={value}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={onComposerActivate}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={handleMarkerDragOver}
              onDrop={handleMarkerDrop}
              // Caret moves (clicks, arrow keys) only update/close an open
              // mention picker — typing is what opens it (handleInputChange).
              onSelect={() => updateMentionTrigger(true)}
              onBlur={() => setMentionTrigger(null)}
              // Track IME composition so the paste handler and the chip
              // cancel-strip path don't mutate the textarea mid-commit.
              // `e.nativeEvent.isComposing` on the paste event is the
              // primary signal; this ref is the cross-browser fallback
              // for browsers that don't surface it (mostly older Safari).
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              className="text-foreground placeholder:text-muted-foreground relative min-h-[72px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-[100px]"
              disabled={inputDisabled}
              placeholder=""
              aria-labelledby={textareaLabelId}
              aria-autocomplete={mentionsEnabled ? 'list' : undefined}
              aria-expanded={mentionsEnabled ? mentionPickerOpen : undefined}
              aria-controls={mentionPickerOpen ? mentionListboxId : undefined}
              aria-activedescendant={
                mentionPickerOpen && mentionResults.length > 0
                  ? `${mentionListboxId}-option-${clampedMentionHighlight}`
                  : undefined
              }
            />
            <PasteImageOverlay
              textareaRef={textareaRef}
              value={value}
              chips={pasteChips}
              onOpen={openPastedImage}
            />
            {value.length === 0 &&
              !inputDisabled &&
              (sendBlockedVisible ? (
                <Text
                  as="div"
                  className="text-destructive pointer-events-none absolute top-0 right-0 left-0 truncate px-0 text-xs"
                  role="status"
                >
                  {sendBlockedReason}
                </Text>
              ) : (
                <Text
                  as="div"
                  variant="muted"
                  className="pointer-events-none absolute top-0 right-0 left-0 flex items-center gap-1"
                >
                  <span className="truncate">{defaultPlaceholder}</span>
                  {/* The Enter-to-send hint is irrelevant on touch keyboards
                    and only crowds the placeholder on narrow viewports. */}
                  <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
                    <span className="border-muted-foreground/30 text-muted-foreground flex size-4 items-center justify-center rounded border">
                      <EnterKeyIcon className="size-3" />
                    </span>
                    {tDialogs('toSend')}
                  </span>
                </Text>
              ))}
            {disabled && (
              <Text
                as="div"
                variant="muted"
                className="pointer-events-none absolute top-0 left-0"
              >
                {disabledReason === 'archived'
                  ? tChat('archivedDisabled')
                  : disabledReason === 'pending-approval'
                    ? tChat('pendingApprovalDisabled')
                    : tChat('noAgentsAvailable')}
              </Text>
            )}
          </div>

          <HStack
            justify="between"
            align="center"
            className="flex-1 gap-2 pb-3 sm:gap-4"
          >
            <HStack
              gap={1}
              align="center"
              className="scrollbar-hide min-w-0 flex-1 overflow-x-auto"
            >
              <ComposerModeMenu
                organizationId={organizationId}
                threadId={threadId}
                onAttachFile={() => fileInputRef.current?.click()}
                fileUploadDisabled={fileUploadDisabled}
                disabled={attachDisabled}
              />
              {onSavePrompt && onOpenPromptLibrary && (
                <SavePromptMenu
                  onSavePromptDraft={() => onSavePrompt(value)}
                  onOpenPromptLibrary={onOpenPromptLibrary}
                  canSavePromptDraft={!inputDisabled && value.trim().length > 0}
                  disabled={inputDisabled}
                />
              )}
              {variant === 'full' &&
                (isArenaMode ? (
                  <ArenaModelSelector organizationId={organizationId} />
                ) : (
                  <HStack gap={2} align="center">
                    <AgentSelector
                      organizationId={organizationId}
                      projectId={projectId}
                      threadId={threadId}
                    />
                    <ModelSelector
                      organizationId={organizationId}
                      projectId={projectId}
                      threadId={threadId}
                    />
                    <ExternalAgentModeToggle
                      threadId={threadId}
                      organizationId={organizationId}
                      disabled={attachDisabled}
                    />
                    <SandboxStateIndicator
                      threadId={threadId}
                      organizationId={organizationId}
                    />
                    {/* No Workspace-files / Live-browser pills here: on desktop
                        the right-edge pane strips are the open affordance, and
                        on mobile the `+` menu carries them — a composer pill
                        would be redundant and crowd this row. */}
                  </HStack>
                ))}
              {variant === 'full' && (
                <ComposerCapabilityPills organizationId={organizationId} />
              )}
            </HStack>
            <HStack gap={1} align="center" className="shrink-0">
              {variant === 'full' && (
                <VoiceModeToggle
                  threadId={threadId}
                  organizationId={organizationId}
                  disabled={attachDisabled}
                />
              )}
              <DictationButton
                ref={dictationRef}
                organizationId={organizationId}
                disabled={attachDisabled}
                lang={speechLang}
                onTranscript={handleTranscript}
              />
              {(() => {
                // Queue mode shares the single button slot: while the turn
                // runs the button is the familiar Stop-with-spinner; the
                // moment the user types, it flips to Send (queue the text).
                // Backspacing to empty flips it back — Stop stays reachable.
                const queueSend =
                  queueModeActive && isLoading && !!value.trim();
                const stopMode = isLoading && !queueSend;
                const sendDisabled = stopMode
                  ? !onStopGenerating
                  : queueSend
                    ? attachments.length > 0 || disabled || sendBlocked
                    : (!value.trim() && attachments.length === 0) ||
                      inputDisabled ||
                      isUploading ||
                      isIndexing ||
                      mediaBlocksSend ||
                      pasteIngestPending ||
                      sendBlocked;
                const tooltipContent =
                  !isLoading && mediaBlockReason
                    ? tChat(MEDIA_BLOCK_TOOLTIP_KEY[mediaBlockReason])
                    : sendBlocked && sendBlockedReason && !isLoading
                      ? sendBlockedReason
                      : '';
                // Native `disabled` swallows pointer events on
                // Chromium/WebKit, so the Tooltip trigger never fires
                // when the button is in exactly the states the tooltip
                // is meant to explain. Wrap the disabled button in a
                // focusable inline span; the span receives pointer +
                // focus events that drive the tooltip while the button
                // itself stays semantically `aria-disabled` so screen
                // readers and keyboard activation still observe the
                // disabled state.
                const button = (
                  <span className="relative inline-flex">
                    {/* Generation in progress: a spinner ring orbits the
                        (now Stop) button so the composer itself signals the
                        in-flight turn. Purely decorative — the live status
                        is announced by the thinking indicator. Hidden while
                        the button shows Send (queue-mode typing) to keep the
                        single slot calm. */}
                    {stopMode && (
                      <span
                        aria-hidden="true"
                        className="border-primary/30 border-t-primary pointer-events-none absolute -inset-1 animate-spin rounded-full border-2"
                      />
                    )}
                    <Button
                      type="button"
                      onClick={stopMode ? onStopGenerating : handleSendMessage}
                      disabled={sendDisabled}
                      size="icon"
                      className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset"
                      aria-label={
                        stopMode ? tChat('stopGenerating') : tChat('send')
                      }
                    >
                      {stopMode ? (
                        <CircleStop className="size-4" />
                      ) : (
                        <ArrowUp className="size-4" />
                      )}
                    </Button>
                  </span>
                );
                return (
                  <Tooltip content={tooltipContent} side="top">
                    {sendDisabled && tooltipContent ? (
                      // role="group" + tabIndex=0 makes the wrapper a
                      // focusable region that the Tooltip's Radix
                      // pointer/focus listeners can attach to —
                      // browsers swallow pointer events on a `disabled`
                      // native button, so the Tooltip would otherwise
                      // never fire in exactly the states the tooltip
                      // is meant to explain. The inner Button still
                      // carries the semantic `disabled` state.
                      <span
                        role="group"
                        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable wrapper required so Tooltip works on a disabled child button
                        tabIndex={0}
                        aria-disabled="true"
                        className="inline-flex"
                      >
                        {button}
                      </span>
                    ) : (
                      button
                    )}
                  </Tooltip>
                );
              })()}
            </HStack>
          </HStack>
        </Stack>
      </FileUpload.DropZone>

      <DataNoticeFooter organizationId={organizationId} className="pt-1 pb-1" />

      {previewImage && (
        <ImagePreviewDialog
          isOpen={!!previewImage}
          onOpenChange={(open) => !open && setPreviewImage(null)}
          src={previewImage.src}
          alt={previewImage.alt}
        />
      )}

      {previewTranscript && (
        <ViewDialog
          open={!!previewTranscript}
          onOpenChange={(open) => !open && setPreviewTranscript(null)}
          title={previewTranscript.fileName}
          description={
            previewTranscript.durationSec
              ? tChat('transcription.previewSubtitle', {
                  seconds: Math.round(previewTranscript.durationSec),
                })
              : undefined
          }
          size="lg"
        >
          <Text
            as="div"
            variant="body"
            className="max-h-[60vh] overflow-y-auto leading-relaxed whitespace-pre-wrap"
          >
            {previewTranscript.transcript}
          </Text>
        </ViewDialog>
      )}
    </div>
  );
}
