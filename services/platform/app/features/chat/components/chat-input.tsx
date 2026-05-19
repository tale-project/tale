'use client';

import { Button } from '@tale/ui/button';
import { X, ArrowUp, CircleStop, Eye, Loader } from 'lucide-react';
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
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { DataNoticeFooter } from '@/app/features/governance/components/data-notice-footer';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT, isAudioOrVideo } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import type { FileAttachment } from '../hooks/use-convex-file-upload';
import { AgentSelector } from './agent-selector';
import { useArenaModeOptional } from './arena/arena-mode-context';
import { ArenaModelSelector } from './arena/arena-model-selector';
import { ComposerCapabilityPills } from './composer-capability-pills';
import { ComposerModeMenu } from './composer-mode-menu';
import { DictationButton } from './dictation-button';
import { ImagePreviewDialog } from './message-bubble';
import { ModelSelector } from './model-selector';
import { SavePromptMenu } from './save-prompt-menu';
import { VideoLinkChip } from './video-link-chip';

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
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  onStopGenerating?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  disabledReason?: 'no-agents' | 'pending-approval' | 'archived';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  organizationId: string;
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
  sendBlocked?: boolean;
  /** Tooltip shown on the send button when `sendBlocked` is true. */
  sendBlockedReason?: string;
}

export function ChatInput({
  value = '',
  onChange,
  onSendMessage,
  onStopGenerating,
  isLoading = false,
  disabled = false,
  disabledReason,
  placeholder,
  organizationId,
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
  videoLinkJobs = [],
  isProcessingVideo = false,
  hasFailedVideoJobs = false,
  ingestVideoUrlsFromText,
  cancelVideoJob,
  retryVideoJob,
  onSavePrompt,
  onOpenPromptLibrary,
  sendBlocked = false,
  sendBlockedReason,
  ...restProps
}: ChatInputProps) {
  const { t: tChat } = useT('chat');
  const { t: tDialogs } = useT('dialogs');
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
  const inputDisabled = disabled || isLoading;

  const handleSendMessage = () => {
    if (
      (!value.trim() && attachments.length === 0) ||
      isLoading ||
      disabled ||
      isUploading ||
      isIndexing ||
      isTranscribing ||
      isProcessingVideo ||
      hasFailedVideoJobs ||
      pasteIngestPending ||
      sendBlocked
    )
      return;

    const attachmentsToSend =
      attachments.length > 0 ? clearAttachments() : undefined;

    onSendMessage(value.trim(), attachmentsToSend);
  };

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
  };

  const handleTranscript = useCallback(
    (transcript: string) => {
      const separator = value.length > 0 && !value.endsWith(' ') ? ' ' : '';
      onChange?.(value + separator + transcript);
    },
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // IME composition guard. macOS Pinyin / Japanese Kotoeri commits a
    // candidate via Enter; without these checks the textarea swallows
    // the commit and sends the half-composed romaji. `isComposing` is
    // the modern WHATWG API, `isComposingRef.current` is our React
    // mirror (composition events arrive on the DOM but React's
    // synthetic event types don't expose `isComposing`), and
    // `keyCode === 229` is the legacy Safari path. All three are
    // necessary to cover Chromium + WebKit + Firefox.
    if (
      e.nativeEvent.isComposing ||
      isComposingRef.current ||
      e.keyCode === 229
    ) {
      return;
    }
    e.preventDefault();
    handleSendMessage();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (inputDisabled || fileUploadDisabled) return;
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
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

  return (
    <div {...restProps} className={cn('bg-background', restProps.className)}>
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
        disabled={inputDisabled || fileUploadDisabled}
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

        <div className="bg-background border-muted-foreground/50 relative mb-2 flex flex-col gap-2 rounded-2xl border px-5 pt-4">
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
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <HStack gap={1} wrap className="mb-2">
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
                          return (
                            <Text
                              as="span"
                              variant="caption"
                              className="text-destructive"
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

          <div className="relative">
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
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
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
              className="text-foreground placeholder:text-muted-foreground relative min-h-[100px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={inputDisabled}
              placeholder=""
              aria-labelledby={textareaLabelId}
            />
            {value.length === 0 && !inputDisabled && (
              <Text
                as="div"
                variant="muted"
                className="pointer-events-none absolute top-0 left-0 flex items-center gap-1"
              >
                {defaultPlaceholder}
                <div className="border-muted-foreground/30 text-muted-foreground flex size-4 items-center justify-center rounded border">
                  <EnterKeyIcon className="size-3" />
                </div>
                {tDialogs('toSend')}
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

          <HStack justify="between" align="center" className="flex-1 pb-3">
            <HStack gap={0} align="center">
              <ComposerModeMenu
                organizationId={organizationId}
                onAttachFile={() => fileInputRef.current?.click()}
                fileUploadDisabled={fileUploadDisabled}
                disabled={inputDisabled}
              />
              {onSavePrompt && onOpenPromptLibrary && (
                <SavePromptMenu
                  onSavePromptDraft={() => onSavePrompt(value)}
                  onOpenPromptLibrary={onOpenPromptLibrary}
                  canSavePromptDraft={!inputDisabled && value.trim().length > 0}
                  disabled={inputDisabled}
                />
              )}
              {isArenaMode ? (
                <ArenaModelSelector organizationId={organizationId} />
              ) : (
                <HStack gap={0} align="center">
                  <AgentSelector organizationId={organizationId} />
                  <ModelSelector organizationId={organizationId} />
                </HStack>
              )}
              <ComposerCapabilityPills organizationId={organizationId} />
            </HStack>
            <HStack gap={1} align="center">
              <DictationButton
                disabled={inputDisabled}
                lang={speechLang}
                onTranscript={handleTranscript}
              />
              {(() => {
                const sendDisabled = isLoading
                  ? !onStopGenerating
                  : (!value.trim() && attachments.length === 0) ||
                    inputDisabled ||
                    isUploading ||
                    isIndexing ||
                    isTranscribing ||
                    isProcessingVideo ||
                    hasFailedVideoJobs ||
                    pasteIngestPending ||
                    sendBlocked;
                const tooltipContent =
                  isTranscribing && !isLoading
                    ? tChat('transcription.inProgressTooltip')
                    : isProcessingVideo && !isLoading
                      ? tChat('videoLink.chip.inProgressTooltip')
                      : hasFailedVideoJobs && !isLoading
                        ? tChat('videoLink.chip.failedSendBlockedTooltip')
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
                  <Button
                    type="button"
                    onClick={isLoading ? onStopGenerating : handleSendMessage}
                    disabled={sendDisabled}
                    size="icon"
                    className="rounded-full"
                    aria-label={
                      isLoading ? tChat('stopGenerating') : tChat('send')
                    }
                  >
                    {isLoading ? (
                      <CircleStop className="size-4" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
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
