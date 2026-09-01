'use client';

/**
 * The composer: the message field and the controls that decide how the
 * message is sent — the `+` mode menu, the model picker, dictation, the
 * voice-output toggle, and send/stop.
 *
 * Model selection only, by design (the Chat·Task·Automation boundary): there
 * is no agent picker, no skill picker, and no sandbox control here. Chat
 * asks and retrieves; work that needs execution or review belongs to a Task.
 *
 * Send and stop are the same slot, because a thread is either taking input
 * or producing output: while a turn is in flight the button stops it, and
 * the field keeps accepting text for the next one.
 *
 * The draft lives here, persisted per conversation (`draftKey`): a
 * half-typed message survives thread switches, navigation, and reloads.
 * The surface reaches in through the imperative handle — a starter fills
 * the field, a failed send restores its snapshot — so keystrokes never
 * re-render the surface tree.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ArrowUp, CircleStop, Loader2 } from 'lucide-react';
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { FileIndexingInfo } from '@/app/features/chat/hooks/use-file-indexing-status';
import type { FileTranscriptionInfo } from '@/app/features/chat/hooks/use-file-transcription-status';
import { extractPastedImageFiles } from '@/app/features/shared/files/clipboard-images';
import type { FileAttachment } from '@/app/features/shared/files/types';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import type { ComposerModelOption, ComposerSelection } from '../types';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import { ComposerAttachments } from './composer-attachments';
import { ComposerModeMenu } from './composer-mode-menu';
import { ComposerSelectionPicker } from './composer-selection-picker';
import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';
import { QuotedReferenceChip } from './quoted-reference-chip';
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

export interface ComposerHandle {
  /** Put text into the field (a conversation starter) and focus it. */
  fillText: (text: string) => void;
  /** Put a failed send's snapshot back — only while the field is still
   * empty, so it never clobbers newer typing. */
  restoreText: (text: string) => void;
  focus: () => void;
}

interface ComposerProps {
  /** Persistence key for the draft — one slot per conversation (and one for
   * the new-chat index), so switching threads swaps drafts instead of
   * carrying text across. */
  draftKey: string;
  /** The direct-served models the chat lane can call. */
  models: readonly ComposerModelOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  /** A turn is in flight — the send button becomes stop. */
  generating?: boolean;
  /** Stop was clicked and the turn has not settled yet — the button
   * acknowledges instantly (disabled, spinner) while the loop catches the
   * cancel; the reactive settle clears it. */
  stopPending?: boolean;
  disabled?: boolean;
  /**
   * Sending alone is blocked — no model picked yet, a turn already running —
   * while typing and the picker stay usable, so the user can fix the reason
   * instead of facing a fully locked composer.
   */
  sendDisabled?: boolean;
  /**
   * Sending is blocked for a reason the user should read (budget exceeded):
   * the disabled send button explains it on hover, and an Enter with content
   * raises it as a toast instead of being a silent no-op.
   */
  sendBlockedReason?: string;
  /** A staged quote (select-to-quote on a reply) — rendered as a removable
   * chip and prepended to the next send as a markdown blockquote. */
  quotedText?: string | null;
  onQuotedTextChange?: (next: string | null) => void;
  /** Files staged for the next send (images, documents/text, audio/video —
   * the 0.3 upload family). The surface owns the upload state; the composer
   * renders the tray and feeds it pasted/dropped/picked files. Absent
   * `onAttachFiles` hides the whole attach surface (arena, read-only). */
  attachments?: readonly FileAttachment[];
  uploadingAttachments?: readonly string[];
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (fileId: string) => void;
  onCancelAttachmentUpload?: (fileId: string) => void;
  /** The file-picker `accept` filter. The surface derives it from the org's
   * upload policy when one is enabled; the default is the full chat family.
   * UX-only — the upload hook re-validates every file either way. */
  attachAccept?: string;
  /** Live transcription status for staged audio/video — send is also
   * gated upstream while any are `queued`/`running`. */
  transcriptionStatuses?: ReadonlyMap<BlobRef, FileTranscriptionInfo>;
  onRetryTranscription?: (fileId: string) => void;
  /** Live RAG-indexing status for staged documents — a send during
   * processing parks server-side and fires when indexing settles. */
  indexingStatuses?: ReadonlyMap<BlobRef, FileIndexingInfo>;
  /** Pasted video links being ingested — each renders as a chip whose
   * transcript will ride the send. */
  videoLinkJobs?: readonly VideoLinkJob[];
  onCancelVideoJob?: (jobId: VideoLinkJob['jobId']) => void;
  onRetryVideoJob?: (jobId: VideoLinkJob['jobId']) => void;
  /** Fires with any pasted/dropped text so the surface can auto-ingest
   * video URLs it contains (0.3's paste-a-link flow). */
  onIngestVideoUrls?: (text: string) => void;
  /** The SERVER-BACKED "Read replies aloud" mode — resolved thread override
   * / user default, written back through `onVoiceOutputChange`. Hidden
   * entirely under an org veto; disabled when no TTS model is configured. */
  voiceOutput?: boolean;
  onVoiceOutputChange?: (next: boolean) => void;
  voiceOutputHidden?: boolean;
  voiceOutputAvailable?: boolean;
  /** The org the dictation fallback transcribes against, plus whether a
   * transcription model is configured — threaded to the mic so browsers
   * without Web Speech (Firefox) get the MediaRecorder + server path. */
  organizationId?: string;
  transcriptionAvailable?: boolean;
  /** Arena Mode — the pair state and its toggle; absent hides the entry. */
  arenaActive?: boolean;
  onArenaChange?: (next: boolean) => void;
}

export const Composer = memo(
  forwardRef<ComposerHandle, ComposerProps>(function Composer(
    {
      draftKey,
      models,
      selection,
      onSelectionChange,
      onSend,
      onStop,
      generating = false,
      stopPending = false,
      disabled = false,
      sendDisabled = false,
      sendBlockedReason,
      quotedText = null,
      onQuotedTextChange,
      attachments = [],
      uploadingAttachments = [],
      onAttachFiles,
      onRemoveAttachment,
      onCancelAttachmentUpload,
      attachAccept = CHAT_UPLOAD_ACCEPT,
      transcriptionStatuses,
      onRetryTranscription,
      indexingStatuses,
      videoLinkJobs = [],
      onCancelVideoJob,
      onRetryVideoJob,
      onIngestVideoUrls,
      voiceOutput,
      onVoiceOutputChange,
      voiceOutputHidden,
      voiceOutputAvailable,
      organizationId,
      transcriptionAvailable,
      arenaActive,
      onArenaChange,
    },
    ref,
  ) {
    const { t } = useT('chat');
    const { t: tDialogs } = useT('dialogs');
    const { i18n } = useTranslation();
    const [text, setText] = usePersistedState(draftKey, '');
    const dictationRef = useRef<DictationButtonHandle>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Names pasted images `pasted-image-N.<ext>` — monotonic for the
    // composer's life, so two pastes of the same screenshot stay two
    // attachments instead of colliding in the upload dedup.
    const pasteCounterRef = useRef(1);
    // React's synthetic events don't expose `isComposing`, so the DOM
    // composition events keep this mirror for the key and paste guards.
    const isComposingRef = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        fillText: (next: string) => {
          setText(next);
          textareaRef.current?.focus();
        },
        restoreText: (next: string) => {
          setText((previous) => (previous.length === 0 ? next : previous));
        },
        focus: () => textareaRef.current?.focus(),
      }),
      [setText],
    );

    const speechLang = toBcp47(i18n.language) ?? 'en-US';

    const blocked = sendBlockedReason !== undefined;
    // An image is a message too: staged attachments (and pasted video
    // links) make an empty field sendable. An upload still in flight holds
    // the send — the turn must never race its own attachment bytes.
    const hasContent =
      text.trim().length > 0 ||
      attachments.length > 0 ||
      videoLinkJobs.length > 0;
    const canSend =
      hasContent &&
      uploadingAttachments.length === 0 &&
      !disabled &&
      !sendDisabled &&
      !blocked;

    const submit = () => {
      // The user clearly meant to send but a stated reason blocks it: say it.
      // The disabled button shows the reason on hover, but a keyboard Enter
      // would otherwise be a silent no-op that reads as "Enter doesn't work".
      if (hasContent && blocked && !generating) {
        toast({ title: sendBlockedReason, variant: 'destructive' });
        return;
      }
      if (!canSend) return;
      // The mic stops on send — it must not keep listening into the next turn.
      dictationRef.current?.stop();
      // Prepend any staged quote as a markdown blockquote so the model sees
      // the referenced passage above the user's message, then clear it.
      const trimmed = text.trim();
      const message =
        quotedText !== null && quotedText.length > 0
          ? `> ${quotedText.replace(/\n/g, '\n> ')}\n\n${trimmed}`
          : trimmed;
      if (quotedText !== null) onQuotedTextChange?.(null);
      onSend(message);
      setText('');
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition guard: macOS Pinyin / Japanese Kotoeri commit a
      // candidate via Enter; without this the commit would send the
      // half-composed text. `isComposing` is the WHATWG API, the ref is the
      // React mirror, and `keyCode === 229` is the legacy Safari path — all
      // three are needed to cover Chromium + WebKit + Firefox.
      const isComposing =
        event.nativeEvent.isComposing ||
        isComposingRef.current ||
        event.keyCode === 229;
      // Enter sends, Shift+Enter breaks the line — the convention every
      // message field in the product follows.
      if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
      event.preventDefault();
      submit();
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      // Mid-composition a rewrite would corrupt the IME commit — let the
      // native paste land untouched.
      if (isComposingRef.current) return;
      // Images first: a clipboard carrying image bytes (a screenshot, a
      // copied image) attaches them instead of pasting the text/alt fallback
      // many clipboards ship alongside — that fallback would double the
      // content as prose the user never wrote.
      if (onAttachFiles !== undefined && !disabled) {
        const imageFiles = extractPastedImageFiles(
          event.clipboardData,
          () => pasteCounterRef.current++,
        );
        if (imageFiles.length > 0) {
          event.preventDefault();
          onAttachFiles(imageFiles);
          return;
        }
      }
      // Collapse the blank-line stacks copying rendered chat markdown leaves
      // behind. Only override the native paste when normalization actually
      // changes the text, so ordinary pastes keep their caret + undo.
      const plainText = event.clipboardData.getData('text/plain');
      if (plainText.length === 0) return;
      // A pasted video URL starts its ingest in the background while the
      // text still lands in the field (the chip references the token; the
      // send strips it). The surface's extractor decides what qualifies.
      if (onIngestVideoUrls !== undefined && !disabled) {
        onIngestVideoUrls(plainText);
      }
      const normalized = normalizeCopiedText(plainText);
      const textarea = textareaRef.current;
      if (normalized === plainText || textarea === null) return;
      event.preventDefault();
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      textarea.setRangeText(normalized, start, end, 'end');
      // setRangeText fires `input` but not `change` on some browsers —
      // propagate explicitly so the controlled value stays in sync.
      setText(textarea.value);
    };

    const handleTranscript = (transcript: string) => {
      setText((previous) => {
        const separator =
          previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
        return previous + separator + transcript;
      });
    };

    // The picked model, for the attachment strip's vision warning. Provider
    // untied picks fall back to the first catalog copy of the id — the same
    // resolution order the turn itself uses. Under Auto the per-model
    // warning is moot (the server narrows to vision models per message) —
    // what still deserves a pre-send warning is a catalog with NO vision
    // model at all, where an image send can only be refused.
    const selectedModel = models.find(
      (model) =>
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
    );
    const visionWarning =
      selection.modelSelection === 'auto'
        ? models.every((model) => model.vision !== true)
          ? t('noModelCanSeeImages')
          : undefined
        : selectedModel !== undefined && selectedModel.vision !== true
          ? t('modelCannotSeeImages')
          : undefined;

    const sendButton = (
      <Button
        variant="primary"
        size="icon"
        onClick={submit}
        disabled={!canSend}
        aria-label={t('send')}
        className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset"
      >
        <ArrowUp aria-hidden className="size-4" />
      </Button>
    );

    return (
      // The whole composer is a drop target (0.3 parity): dragging files
      // anywhere over it shows the overlay and dropping stages them through
      // the same lane the paste and the picker use. `clickable` stays off —
      // the field must keep taking clicks as a text field.
      <FileUpload.Root>
        <FileUpload.DropZone
          className="relative mx-auto w-full max-w-3xl"
          onFilesSelected={(files) => onAttachFiles?.(files)}
          {...(onIngestVideoUrls !== undefined && !disabled
            ? { onTextDrop: onIngestVideoUrls }
            : {})}
          clickable={false}
          disabled={onAttachFiles === undefined || disabled}
        >
          <FileUpload.Overlay className="rounded-xl sm:rounded-2xl" />
          <Stack
            gap={2}
            aria-label={t('aria.chatRegion')}
            as="section"
            // Soft top shadow lifts the composer off the conversation above it.
            className="border-border sm:border-muted-foreground/50 bg-background relative w-full rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]"
          >
            {onQuotedTextChange !== undefined && (
              <QuotedReferenceChip
                quotedText={quotedText}
                onClear={() => onQuotedTextChange(null)}
              />
            )}
            {videoLinkJobs.length > 0 && (
              <Row gap={2} wrap align="center">
                {videoLinkJobs.map((job) => (
                  <VideoLinkChip
                    key={job.jobId}
                    job={job}
                    onCancel={() => onCancelVideoJob?.(job.jobId)}
                    onRetry={() => onRetryVideoJob?.(job.jobId)}
                  />
                ))}
              </Row>
            )}
            {onAttachFiles !== undefined && (
              <>
                <ComposerAttachments
                  attachments={attachments}
                  uploadingFiles={uploadingAttachments}
                  onRemove={(fileId) => onRemoveAttachment?.(fileId)}
                  onCancelUpload={(fileId) =>
                    onCancelAttachmentUpload?.(fileId)
                  }
                  {...(visionWarning !== undefined ? { visionWarning } : {})}
                  {...(transcriptionStatuses !== undefined
                    ? { transcriptionStatuses }
                    : {})}
                  {...(onRetryTranscription !== undefined
                    ? { onRetryTranscription }
                    : {})}
                  {...(indexingStatuses !== undefined
                    ? { indexingStatuses }
                    : {})}
                />
                {/* The picker path into the same upload lane the paste and the
                drop use — the full 0.3 family: images, documents, text,
                audio/video. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={attachAccept}
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])];
                    if (files.length > 0) onAttachFiles(files);
                    // Selecting the same file twice must re-fire the change.
                    event.target.value = '';
                  }}
                />
              </>
            )}
            <div className="relative">
              <Textarea
                ref={textareaRef}
                // The field sits under a visible section, so its name is carried by
                // `aria-label` rather than a label that would duplicate the chrome.
                aria-label={t('aria.chatInput')}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                }}
                // The placeholder renders as the overlay below so it can carry the
                // Enter-to-send hint; the attribute stays empty.
                placeholder=""
                disabled={disabled}
                // Chromeless inside the composer's own frame: the field must not
                // draw its own border or focus ring — ring-0 alone still paints the
                // ring OFFSET shadow as a faint outline, so the offset goes to 0
                // with it.
                className="text-foreground placeholder:text-muted-foreground relative min-h-[72px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-[100px]"
              />
              {/* Shown even while disabled: an empty field with no invitation reads
              as broken chrome, and the disabled styling already says the field
              is not taking input yet. */}
              {text.length === 0 && (
                <Text
                  as="div"
                  variant="muted"
                  className="pointer-events-none absolute top-0 right-0 left-0 flex items-center gap-1"
                >
                  {/* The 0.3 invitation named what chat can reach; the wording
                  tracks the boundary model's actual reach (documents + web). */}
                  <span className="truncate">{t('placeholder')}</span>
                  {/* The Enter-to-send hint is irrelevant on touch keyboards and
                  only crowds the placeholder on narrow viewports. */}
                  <span className="hidden shrink-0 items-center gap-1 sm:inline-flex">
                    <span className="border-muted-foreground/30 text-muted-foreground flex size-4 items-center justify-center rounded border">
                      <EnterKeyIcon className="size-3" />
                    </span>
                    {tDialogs('toSend')}
                  </span>
                </Text>
              )}
            </div>

            <Row
              gap={2}
              justify="between"
              align="center"
              className="min-w-0 pb-3 sm:gap-4"
            >
              <Row
                gap={1}
                align="center"
                className="scrollbar-hide min-w-0 flex-1 overflow-x-auto"
              >
                <ComposerModeMenu
                  {...(arenaActive !== undefined ? { arenaActive } : {})}
                  {...(onArenaChange !== undefined ? { onArenaChange } : {})}
                  {...(onAttachFiles !== undefined
                    ? { onAttachFiles: () => fileInputRef.current?.click() }
                    : {})}
                  disabled={disabled}
                />
                <ComposerSelectionPicker
                  models={models}
                  selection={selection}
                  onSelectionChange={onSelectionChange}
                  disabled={disabled}
                />
              </Row>

              <Row gap={1} align="center" className="shrink-0">
                {voiceOutputHidden !== true &&
                  onVoiceOutputChange !== undefined && (
                    <VoiceModeToggle
                      enabled={voiceOutput ?? false}
                      onChange={onVoiceOutputChange}
                      available={voiceOutputAvailable ?? true}
                      disabled={disabled}
                    />
                  )}
                <DictationButton
                  ref={dictationRef}
                  disabled={disabled}
                  lang={speechLang}
                  onTranscript={handleTranscript}
                  {...(organizationId !== undefined ? { organizationId } : {})}
                  {...(transcriptionAvailable !== undefined
                    ? { transcriptionAvailable }
                    : {})}
                />
                <span className="relative inline-flex">
                  {/* Generation in progress: a spinner ring orbits the (now Stop)
                  button so the composer itself signals the in-flight turn.
                  Purely decorative — the live status is announced elsewhere. */}
                  {generating && (
                    <span
                      aria-hidden="true"
                      className="border-primary/30 border-t-primary pointer-events-none absolute -inset-1 animate-spin rounded-full border-2 motion-reduce:animate-none"
                    />
                  )}
                  {generating ? (
                    // A clicked Stop acknowledges INSTANTLY — disabled with a
                    // spinner while the loop catches the cancel flag; the turn
                    // settling (reactively) returns the send button. Without
                    // this the click reads as ignored during the seconds the
                    // provider takes to notice.
                    <Button
                      variant="primary"
                      size="icon"
                      onClick={onStop}
                      disabled={stopPending}
                      aria-label={
                        stopPending
                          ? t('stoppingGeneration')
                          : t('stopGenerating')
                      }
                      className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset"
                    >
                      {stopPending ? (
                        <Loader2
                          aria-hidden
                          className="size-4 animate-spin motion-reduce:animate-none"
                        />
                      ) : (
                        <CircleStop aria-hidden className="size-4" />
                      )}
                    </Button>
                  ) : blocked ? (
                    // A stated block (budget): the tooltip must fire on a
                    // disabled button, but browsers swallow its pointer events —
                    // the focusable group wrapper gives Radix a live target while
                    // the inner button keeps the semantic `disabled`.
                    <Tooltip content={sendBlockedReason} side="top">
                      <span
                        role="group"
                        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable wrapper required so the Tooltip works on a disabled child button
                        tabIndex={0}
                        aria-disabled="true"
                        className="inline-flex"
                      >
                        {sendButton}
                      </span>
                    </Tooltip>
                  ) : (
                    sendButton
                  )}
                </span>
              </Row>
            </Row>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>
    );
  }),
);
