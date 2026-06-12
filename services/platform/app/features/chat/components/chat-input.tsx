'use client';

import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { X, ArrowUp, CircleStop, Eye, Loader, RotateCcw } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useCallback,
  useId,
  useRef,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT, isAudioOrVideo } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';

import { useChatLayout } from '../context/chat-layout-context';
import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import type { FileAttachment } from '../hooks/use-convex-file-upload';
import {
  detectMentionTrigger,
  MAX_KB_MENTIONS,
  type KbMention,
  type MentionTrigger,
} from '../hooks/use-kb-mentions';
import { captureScreenshot } from '../utils/capture-screenshot';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import { AgentSelector } from './agent-selector';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaModelSelector } from './arena/arena-model-selector';
import { ComposerCapabilityPills } from './composer-capability-pills';
import { ComposerModeMenu } from './composer-mode-menu';
import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';
import { createDocumentsMentionSource } from './documents-mention-source';
import { KbMentionPopover } from './kb-mention-popover';
import { ImagePreviewDialog } from './message-bubble';
import { ModelSelector } from './model-selector';
import { QuotedReferenceChip } from './quoted-reference-chip';
import { SavePromptMenu } from './save-prompt-menu';
import { VideoLinkChip } from './video-link-chip';
import { VoiceModeToggle } from './voice-mode-toggle';

// Web Speech requires a fully-qualified BCP-47 tag. Already-regional codes
// (`de-CH`, future `fr-CA`) pass through; bare base locales pick the most
// common region default. Unknown locales fall back to en-US at the call site.
const BASE_LOCALE_DEFAULTS: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
};

function toBcp47(locale: string): string | undefined {
  if (locale.includes('-')) return locale;
  return BASE_LOCALE_DEFAULTS[locale];
}

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
   * Which composer controls to render. `'full'` (default) is the main chat.
   * `'assistant'` is the editor AI panels (automations / organigram), where
   * the agent is pinned server-side — the agent/model pickers, capability
   * pills (image generation etc.) and the voice-mode toggle would be
   * decorative at best and misleading at worst, so they're hidden.
   * Attachments, dictation and send stay.
   */
  variant?: 'full' | 'assistant';
}

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
  onComposerActivate,
  kbMentions,
  addKbMention,
  removeKbMention,
  clearKbMentions,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationRef = useRef<DictationButtonHandle>(null);
  // True while a CJK IME (Chinese / Japanese / Korean) is composing a
  // pre-commit string. Cross-browser fallback for
  // `e.nativeEvent.isComposing`, which not every browser surfaces on the
  // paste event itself. Blocks `handlePaste` and the chip-cancel strip
  // path so we don't mutate the textarea while an IME commit is in
  // flight (round-2 V10 / HIGH #19).
  const isComposingRef = useRef(false);
  // Set as soon as a paste begins ingest; cleared in `.finally`. The
  // send-gate ORs this in so a paste-then-Enter race can't bypass the
  // chip rendering (chip query won't show the row until the mutation
  // round-trip lands, but `ingestVideoUrlsFromText` runs fire-and-forget
  // so without this flag the gate has nothing to watch) — round-2 V10 /
  // HIGH #23.
  const pasteIngestInFlightRef = useRef(false);
  const [pasteIngestPending, setPasteIngestPending] = useState(false);
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
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(
    null,
  );
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const mentionListboxId = `${textareaId}-kb-mentions`;
  const mentionPickerOpen =
    kbMentionsEnabled && mentionTrigger !== null && !attachDisabled;

  // SearchSource contract: stable identity, called unconditionally every
  // render (it is a hook); inactive renders pass 'skip' to Convex.
  const mentionSource = useMemo(
    () => createDocumentsMentionSource({ organizationId }),
    [organizationId],
  );
  const mentionState = mentionSource(mentionTrigger?.query ?? '', {
    active: mentionPickerOpen,
    open: mentionPickerOpen,
  });
  const mentionResults = useMemo(
    () => mentionState.results.slice(0, 8),
    [mentionState.results],
  );
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
      if (!kbMentionsEnabled) return;
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
    [kbMentionsEnabled],
  );

  const handleSelectMention = useCallback(
    (mention: KbMention) => {
      const trigger = mentionTrigger;
      if (!trigger || !kbMentionsEnabled) return;
      const added = addKbMention?.(mention) ?? false;
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
      // Replace the typed `@query` with `@Title ` prose. `setRangeText` on
      // the DOM node keeps the caret + undo stack intact (same rationale as
      // the video-link chip strip path below).
      const insertion = `@${mention.title} `;
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.setRangeText(insertion, trigger.start, trigger.end, 'end');
        onChange?.(textarea.value);
      } else {
        onChange?.(
          value.slice(0, trigger.start) + insertion + value.slice(trigger.end),
        );
      }
      setMentionTrigger(null);
      setMentionHighlight(0);
    },
    [
      mentionTrigger,
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
      toast({ title: sendBlockedReason, variant: 'destructive' });
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
      isTranscribing ||
      isProcessingVideo ||
      hasFailedVideoJobs ||
      hasFailedAudioJobs ||
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
    // the referenced passage above the user's message, then clear it.
    const trimmed = value.trim();
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

  const screenshotSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia;

  const handleTakeScreenshot = useCallback(async () => {
    try {
      const file = await captureScreenshot();
      if (file) await uploadFiles([file]);
    } catch (err) {
      // The user dismissing the OS picker rejects with NotAllowed/Abort —
      // treat as a silent cancel, surface anything else.
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'AbortError')
      ) {
        return;
      }
      console.error('[screenshot] capture failed', err);
      toast({ title: tComposer('screenshotFailed'), variant: 'destructive' });
    }
  }, [uploadFiles, tComposer]);

  const imageAttachments = useMemo(
    () => attachments.filter((att) => att.fileType.startsWith('image/')),
    [attachments],
  );

  const fileAttachments = useMemo(
    () => attachments.filter((att) => !att.fileType.startsWith('image/')),
    [attachments],
  );

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
        const selected = mentionResults[clampedMentionHighlight]?.data;
        if (selected) {
          e.preventDefault();
          handleSelectMention(selected);
          return;
        }
        // No results to pick: Enter falls through to send below.
      }
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

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const extension = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const renamedFile = new File(
            [file],
            `pasted-image-${timestamp}.${extension}`,
            { type: file.type },
          );
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      void uploadFiles(imageFiles);
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
      if (text) {
        // Set the in-flight ref BEFORE awaiting the ingest so the send-
        // gate sees the pending state on the very next render. Cleared
        // in `.finally`. Without this, a user who pastes then hits
        // Enter immediately would ship the message before the mutation
        // round-trip lands and the chip query reflects the new row.
        pasteIngestInFlightRef.current = true;
        setPasteIngestPending(true);
        void ingestVideoUrlsFromText(
          text,
          organizationId,
          i18n.language,
        ).finally(() => {
          pasteIngestInFlightRef.current = false;
          setPasteIngestPending(false);
        });
      }
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
        onTextDrop={
          ingestVideoUrlsFromText
            ? (text) => {
                // Mirror the paste-handler gate so a drag-and-drop URL
                // followed by an immediate Enter doesn't beat the chip
                // into existence — without this, the send-gate doesn't
                // know an ingest is in-flight and the agent receives
                // the raw URL instead of the transcript.
                pasteIngestInFlightRef.current = true;
                setPasteIngestPending(true);
                void ingestVideoUrlsFromText(
                  text,
                  organizationId,
                  i18n.language,
                ).finally(() => {
                  pasteIngestInFlightRef.current = false;
                  setPasteIngestPending(false);
                });
              }
            : undefined
        }
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
        <div className="border-border sm:border-muted-foreground/50 relative mb-2 flex flex-col gap-2 rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]">
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
            <HStack gap={1} wrap className="mb-2">
              {kbMentionsEnabled &&
                kbMentions?.map((mention) => (
                  <div
                    key={mention.documentId}
                    className="bg-muted group relative flex max-w-[280px] items-center gap-3 rounded-lg px-3 py-2"
                  >
                    <DocumentIcon
                      fileName={
                        mention.extension
                          ? `${mention.title}.${mention.extension}`
                          : mention.title
                      }
                      mimeType={mention.fileType}
                    />
                    <VStack className="min-w-0 flex-1 gap-1">
                      <Text as="div" variant="label" title={mention.title}>
                        {middleEllipsis(mention.title, 28)}
                      </Text>
                      <Text
                        as="span"
                        variant="caption"
                        className="text-muted-foreground/50"
                      >
                        {tComposer('kbMention.chipLabel')}
                      </Text>
                    </VStack>
                    <button
                      type="button"
                      aria-label={tComposer('kbMention.removeMention', {
                        title: mention.title,
                      })}
                      onClick={() => removeKbMention?.(mention.documentId)}
                      className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="text-muted-foreground size-3" />
                    </button>
                  </div>
                ))}
              {imageAttachments.map((attachment) => (
                <div
                  key={attachment.fileId}
                  className="ring-border group relative size-9 overflow-hidden rounded-lg ring-1"
                >
                  <button
                    type="button"
                    aria-label={tChat('viewImage')}
                    onClick={() =>
                      attachment.previewUrl &&
                      setPreviewImage({
                        src: attachment.previewUrl,
                        alt: attachment.fileName,
                      })
                    }
                    className="bg-muted focus:ring-ring size-full cursor-pointer transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                  >
                    {attachment.previewUrl ? (
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.fileName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200">
                        <span className="text-xs text-blue-600">
                          {tChat('fileTypes.image')}
                        </span>
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={tChat('removeAttachment')}
                    onClick={() => removeAttachment(attachment.fileId)}
                    className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="text-muted-foreground size-3" />
                  </button>
                </div>
              ))}

              {fileAttachments.map((attachment) => {
                const audioInfo = isAudioOrVideo(attachment.fileType)
                  ? transcriptionStatuses?.get(attachment.fileId)
                  : undefined;
                const canPreviewTranscript =
                  audioInfo?.status === 'completed' && !!audioInfo.transcript;

                return (
                  <div
                    key={attachment.fileId}
                    className="bg-muted group relative flex max-w-[280px] items-center gap-3 rounded-lg px-3 py-2"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <VStack className="min-w-0 flex-1 gap-1">
                      <Text
                        as="div"
                        variant="label"
                        title={attachment.fileName}
                      >
                        {middleEllipsis(attachment.fileName, 28)}
                      </Text>
                      {(() => {
                        // Audio + video attachments: show two-phase status
                        // (transcribing → indexing → indexed) instead of the
                        // RAG-indexing status we show for other uploads.
                        if (isAudioOrVideo(attachment.fileType)) {
                          const info = transcriptionStatuses?.get(
                            attachment.fileId,
                          );
                          const status = info?.status;
                          const ragStatus = info?.ragStatus;
                          if (status === 'queued' || status === 'running') {
                            return (
                              <HStack gap={1} align="center">
                                <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                                <Text
                                  as="span"
                                  variant="caption"
                                  className="text-muted-foreground/50"
                                >
                                  {info?.progress ||
                                    tChat('transcription.transcribing')}
                                </Text>
                              </HStack>
                            );
                          }
                          if (
                            status === 'completed' &&
                            (ragStatus === 'queued' || ragStatus === 'running')
                          ) {
                            return (
                              <HStack gap={1} align="center">
                                <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                                <Text
                                  as="span"
                                  variant="caption"
                                  className="text-muted-foreground/50"
                                >
                                  {tChat('transcription.indexing')}
                                </Text>
                              </HStack>
                            );
                          }
                          if (status === 'completed') {
                            // `ragStatus` completed → "Indexed" (agent can
                            // retrieve). `ragStatus === 'failed'` → show
                            // "Transcribed" but warn the agent retrieval
                            // will be unavailable.
                            const label =
                              ragStatus === 'completed'
                                ? tChat('transcription.indexed')
                                : ragStatus === 'failed'
                                  ? tChat('transcription.indexingFailed')
                                  : tChat('transcription.transcribed');
                            return (
                              <Text
                                as="span"
                                variant="caption"
                                className={
                                  ragStatus === 'failed'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground/70'
                                }
                              >
                                {label}
                              </Text>
                            );
                          }
                          if (status === 'failed' || status === 'skipped') {
                            return (
                              <Text
                                as="span"
                                variant="caption"
                                className="text-destructive"
                              >
                                {tChat('transcription.couldNotTranscribe')}
                              </Text>
                            );
                          }
                          return (
                            <Text
                              as="div"
                              variant="caption"
                              className="text-muted-foreground/50"
                            >
                              {formatFileSize(attachment.fileSize)}
                            </Text>
                          );
                        }

                        const info = indexingStatuses?.get(attachment.fileId);
                        const ragStatus = info?.status;
                        if (ragStatus === 'queued' || ragStatus === 'running') {
                          const raw = info?.progress;
                          // Convert "extracting 42/108" → "39%"
                          let progressLabel = tChat('indexing');
                          if (raw) {
                            const match = /(\d+)\/(\d+)/.exec(raw);
                            if (match) {
                              const pct = Math.round(
                                (Number(match[1]) / Number(match[2])) * 100,
                              );
                              progressLabel = `${pct}%`;
                            } else {
                              progressLabel = raw;
                            }
                          }
                          return (
                            <HStack gap={1} align="center">
                              <Loader className="text-muted-foreground/50 size-3 animate-spin" />
                              <Text
                                as="span"
                                variant="caption"
                                className="text-muted-foreground/50"
                              >
                                {progressLabel}
                              </Text>
                            </HStack>
                          );
                        }
                        if (ragStatus === 'failed') {
                          // Surface the stored failure reason (ragError) so
                          // the user can tell a transient outage from a
                          // rejected file without digging into logs.
                          return (
                            <Text
                              as="span"
                              variant="caption"
                              className="text-destructive"
                              title={info?.error}
                            >
                              {tChat('indexingFailed')}
                            </Text>
                          );
                        }
                        return (
                          <Text
                            as="div"
                            variant="caption"
                            className="text-muted-foreground/50"
                          >
                            {formatFileSize(attachment.fileSize)}
                          </Text>
                        );
                      })()}
                    </VStack>
                    <button
                      type="button"
                      aria-label={tChat('removeAttachment')}
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <X className="text-muted-foreground size-3" />
                    </button>
                    {canPreviewTranscript && (
                      <button
                        type="button"
                        aria-label={tChat('transcription.viewTranscript')}
                        title={tChat('transcription.viewTranscript')}
                        onClick={() =>
                          setPreviewTranscript({
                            fileName: attachment.fileName,
                            transcript: audioInfo?.transcript ?? '',
                            durationSec: audioInfo?.durationSec,
                          })
                        }
                        className="bg-background text-muted-foreground hover:text-foreground absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full transition-colors"
                      >
                        <Eye className="size-3" />
                      </button>
                    )}
                    {audioInfo?.status === 'failed' &&
                      retryAudioTranscription && (
                        // Retry a failed transcription — reuses the persisted
                        // `_storage` blob (no re-upload). Mutually exclusive
                        // with the view-transcript (Eye) button, which only
                        // renders on `completed`, so both can share the
                        // bottom-right corner. Mirrors the video-link chip's
                        // retry affordance.
                        <button
                          type="button"
                          aria-label={tChat('transcription.retry')}
                          title={tChat('transcription.retry')}
                          onClick={() =>
                            retryAudioTranscription(attachment.fileId)
                          }
                          className="bg-background text-muted-foreground hover:text-foreground absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full transition-colors"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      )}
                  </div>
                );
              })}

              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  role="status"
                  aria-label={tChat('uploadingFile')}
                  className="border-border bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg border"
                >
                  <Loader className="text-muted-foreground size-4 animate-spin" />
                </div>
              ))}
            </HStack>
          )}

          <QuotedReferenceChip />

          <div className="relative">
            {mentionPickerOpen && mentionTrigger && (
              <KbMentionPopover
                results={mentionResults}
                status={mentionState.status}
                query={mentionTrigger.query}
                highlightedIndex={clampedMentionHighlight}
                onHighlight={setMentionHighlight}
                onSelect={handleSelectMention}
                listboxId={mentionListboxId}
                optionId={(index) => `${mentionListboxId}-option-${index}`}
              />
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
              aria-autocomplete={kbMentionsEnabled ? 'list' : undefined}
              aria-expanded={kbMentionsEnabled ? mentionPickerOpen : undefined}
              aria-controls={mentionPickerOpen ? mentionListboxId : undefined}
              aria-activedescendant={
                mentionPickerOpen && mentionResults.length > 0
                  ? `${mentionListboxId}-option-${clampedMentionHighlight}`
                  : undefined
              }
            />
            {value.length === 0 && !inputDisabled && (
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
            )}
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
                onAttachFile={() => fileInputRef.current?.click()}
                onTakeScreenshot={
                  screenshotSupported && !fileUploadDisabled
                    ? () => void handleTakeScreenshot()
                    : undefined
                }
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
                  <HStack gap={1} align="center">
                    <AgentSelector
                      organizationId={organizationId}
                      projectId={projectId}
                    />
                    <ModelSelector
                      organizationId={organizationId}
                      projectId={projectId}
                    />
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
                // Queue mode: the send button keeps its send identity (the
                // separate Stop control below covers stopping) and gates on
                // text-only input.
                const queueSend = queueModeActive && isLoading;
                const sendDisabled =
                  isLoading && !queueSend
                    ? !onStopGenerating
                    : queueSend
                      ? !value.trim() ||
                        attachments.length > 0 ||
                        disabled ||
                        sendBlocked
                      : (!value.trim() && attachments.length === 0) ||
                        inputDisabled ||
                        isUploading ||
                        isIndexing ||
                        isTranscribing ||
                        isProcessingVideo ||
                        hasFailedVideoJobs ||
                        hasFailedAudioJobs ||
                        pasteIngestPending ||
                        sendBlocked;
                const tooltipContent =
                  isTranscribing && !isLoading
                    ? tChat('transcription.inProgressTooltip')
                    : isProcessingVideo && !isLoading
                      ? tChat('videoLink.chip.inProgressTooltip')
                      : hasFailedVideoJobs && !isLoading
                        ? tChat('videoLink.chip.failedSendBlockedTooltip')
                        : hasFailedAudioJobs && !isLoading
                          ? tChat('transcription.failedSendBlockedTooltip')
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
                const stopMode = isLoading && !queueSend;
                const button = (
                  <span className="relative inline-flex">
                    {/* Generation in progress: a spinner ring orbits the
                        (now Stop) button so the composer itself signals the
                        in-flight turn. Purely decorative — the live status
                        is announced by the thinking indicator. In queue mode
                        the ring moves to the separate Stop control instead. */}
                    {isLoading && !queueSend && (
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
                  <HStack gap={1} align="center">
                    {/* Queue mode: the send button stays a send button, so
                        Stop gets its own control with the spinner ring. */}
                    {queueSend && onStopGenerating && (
                      <span className="relative inline-flex">
                        <span
                          aria-hidden="true"
                          className="border-primary/30 border-t-primary pointer-events-none absolute -inset-1 animate-spin rounded-full border-2"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={onStopGenerating}
                          className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset"
                          aria-label={tChat('stopGenerating')}
                        >
                          <CircleStop className="size-4" />
                        </Button>
                      </span>
                    )}
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
                  </HStack>
                );
              })()}
            </HStack>
          </HStack>
        </div>
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
