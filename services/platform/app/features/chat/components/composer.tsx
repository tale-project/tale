'use client';

/**
 * The composer: the message field and the controls that decide how the
 * message is sent — the `+` mode menu, the model picker, dictation, the
 * voice-output toggle, and send/stop.
 *
 * Skills are the person's to choose: typing `/` at the start of the message
 * (or **Use a skill** in the `+` menu) opens the skills they may use, and a
 * pick writes `/name` into the message, which its reply reads before the
 * model answers (`lib/skills/slash.ts`); the picker's Skills section sets
 * them for the whole conversation. There is no agent picker and no sandbox
 * control (the Chat·Task·Automation boundary): the assistant makes files
 * with its own tools, and work that needs an owner or a review belongs to a
 * Task.
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
import { cn } from '@tale/ui/cn';
import { FileUpload } from '@tale/ui/file-upload';
import { EnterKeyIcon } from '@tale/ui/icons/enter-key-icon';
import { Row, Stack } from '@tale/ui/layout';
import { SendButton } from '@tale/ui/send-button';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import {
  THREAD_COMPOSER_FIELD_CLASS,
  THREAD_COMPOSER_FRAME_CLASS,
  THREAD_COMPOSER_TOOLBAR_CLASS,
} from '@tale/ui/thread/layout';
import { Tooltip } from '@tale/ui/tooltip';
import { TypeaheadListbox } from '@tale/ui/typeahead-listbox';
import { useAutoGrow } from '@tale/ui/use-auto-grow';
import { useImeComposition } from '@tale/ui/use-ime-composition';
import { toast } from '@tale/ui/use-toast';
import { BookOpen, CircleStop, Loader2 } from 'lucide-react';
import {
  forwardRef,
  memo,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { FileIndexingInfo } from '@/app/features/chat/hooks/use-file-indexing-status';
import type { FileTranscriptionInfo } from '@/app/features/chat/hooks/use-file-transcription-status';
import { extractPastedImageFiles } from '@/app/features/shared/files/clipboard-images';
import type { FileAttachment } from '@/app/features/shared/files/types';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import type { ComposerSkillChoices } from '@/app/lib/backend/chat';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
import { hasVisibleText } from '@/lib/shared/utils/visible-text';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import {
  completeSkillToken,
  insertSkillSlash,
  matchSkills,
  skillTokenAtCaret,
} from '../lib/skill-picks';
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
  /** DOM id for the message field — the target of a skip link that jumps
   * past the sidebar straight to the box. */
  textareaId?: string;
  /** The direct-served models the chat lane can call. */
  models: readonly ComposerModelOption[];
  /** Providers whose models only a subscription serves, which chat leaves
   * out — the picker says why. */
  subscriptionProviders?: readonly string[];
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
  /** Shared organization transcription capability for uploads and dictation. */
  organizationId?: string;
  transcriptionAvailable?: boolean;
  transcriptionUnavailableReason?: string;
  onTranscriptionUnavailable?: (reason?: string) => void;
  /** Arena Mode — the pair state and its toggle; absent hides the entry. */
  arenaActive?: boolean;
  onArenaChange?: (next: boolean) => void;
  /** The skills the person may choose. Absent, disabled or empty hides the
   * `/` typeahead, the `+` menu's entry and the picker's Skills section. */
  skillChoices?: ComposerSkillChoices;
}

export const Composer = memo(
  forwardRef<ComposerHandle, ComposerProps>(function Composer(
    {
      draftKey,
      textareaId,
      models,
      subscriptionProviders,
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
      transcriptionUnavailableReason,
      onTranscriptionUnavailable,
      arenaActive,
      onArenaChange,
      skillChoices,
    },
    ref,
  ) {
    const { t } = useT('chat');
    const { t: tDialogs } = useT('dialogs');
    const { i18n } = useTranslation();
    const [text, setText] = usePersistedState(draftKey, '');
    const dictationRef = useRef<DictationButtonHandle>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // The field starts at its empty size and grows with the draft up to its
    // cap, then scrolls inside (`THREAD_COMPOSER_FIELD_CLASS`).
    useAutoGrow(textareaRef, text);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Names pasted images `pasted-image-N.<ext>` — monotonic for the
    // composer's life, so two pastes of the same screenshot stay two
    // attachments instead of colliding in the upload dedup.
    const pasteCounterRef = useRef(1);
    const { isComposing, compositionProps } = useImeComposition();

    // The skills typeahead: a `/` and the start of a name at the start of
    // the message opens the skills the person may use. The caret decides —
    // a name typed anywhere else is the message's own words. Escape closes
    // it until the text changes.
    const skills =
      skillChoices?.enabled === true && !disabled ? skillChoices.skills : [];
    const [caret, setCaret] = useState<number | null>(null);
    const [dismissedText, setDismissedText] = useState<string | null>(null);
    const [skillHighlight, setSkillHighlight] = useState(0);
    const pendingCaretRef = useRef<number | null>(null);
    const skillListboxId = useId();
    const skillOptionId = (index: number) =>
      `${skillListboxId}-option-${index}`;
    const skillToken =
      skills.length > 0 && caret !== null
        ? skillTokenAtCaret(text, caret)
        : null;
    const skillMatches =
      skillToken === null ? [] : matchSkills(skills, skillToken.query);
    const skillPickerOpen = skillToken !== null && dismissedText !== text;
    const skillsListed = skillPickerOpen && skillMatches.length > 0;
    const skillIndex = Math.min(
      skillHighlight,
      Math.max(skillMatches.length - 1, 0),
    );
    // A pick or the `+` menu rewrote the text: put the caret where the
    // rewrite says, once the field holds the new text.
    useLayoutEffect(() => {
      const at = pendingCaretRef.current;
      const textarea = textareaRef.current;
      if (at === null || textarea === null) return;
      pendingCaretRef.current = null;
      textarea.focus();
      textarea.setSelectionRange(at, at);
      setCaret(at);
    }, [text]);
    const syncCaret = (field: HTMLTextAreaElement) => {
      setCaret(
        field.selectionStart === field.selectionEnd ? field.selectionEnd : null,
      );
    };
    /** Put `next.text` in the field and the caret at `next.caret`: once the
     * field holds the new text, or at once when the text is already that —
     * a name picked where it is already written changes no text, and no
     * render would follow to move the caret. */
    const rewrite = (next: { text: string; caret: number }) => {
      if (next.text === text) {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(next.caret, next.caret);
        setCaret(next.caret);
        return;
      }
      pendingCaretRef.current = next.caret;
      setText(next.text);
    };
    const pickSkill = (index: number) => {
      const skill = skillMatches[index];
      if (skillToken === null || skill === undefined) return;
      setSkillHighlight(0);
      rewrite(completeSkillToken(text, skillToken, skill.slug));
    };
    const startSkillPick = () => {
      setDismissedText(null);
      setSkillHighlight(0);
      rewrite(insertSkillSlash(text));
    };

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
    // the send — the turn must never race its own attachment bytes. Text
    // counts only when a reader would see it — the REST door's blank rule,
    // so a pasted run of zero-width characters is not a message.
    const hasContent =
      hasVisibleText(text) ||
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
      // While the skills typeahead is open it takes the keys a listbox
      // needs: Up/Down move, Enter or Tab pick, Escape closes. With nothing
      // matching, Enter sends the message as written.
      if (skillPickerOpen && !isComposing(event.nativeEvent)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setDismissedText(text);
          return;
        }
        if (skillMatches.length > 0) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setSkillHighlight(
              Math.min(Math.max(skillIndex + step, 0), skillMatches.length - 1),
            );
            return;
          }
          if (
            event.key === 'Tab' ||
            (event.key === 'Enter' &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey)
          ) {
            event.preventDefault();
            pickSkill(skillIndex);
            return;
          }
        }
      }
      // Enter sends, Shift+Enter breaks the line — the convention every
      // message field in the product follows.
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        isComposing(event.nativeEvent)
      )
        return;
      event.preventDefault();
      submit();
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      // Mid-composition a rewrite would corrupt the IME commit — let the
      // native paste land untouched.
      if (isComposing()) return;
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
      <SendButton label={t('send')} onClick={submit} disabled={!canSend} />
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
            className={THREAD_COMPOSER_FRAME_CLASS}
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
                  {...(transcriptionAvailable !== undefined
                    ? { transcriptionAvailable }
                    : {})}
                  transcriptionUnavailableReason={
                    transcriptionUnavailableReason
                  }
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
                id={textareaId}
                // The field sits under a visible section, so its name is carried by
                // `aria-label` rather than a label that would duplicate the chrome.
                aria-label={t('aria.chatInput')}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setSkillHighlight(0);
                  syncCaret(event.target);
                }}
                onKeyDown={onKeyDown}
                onKeyUp={(event) => syncCaret(event.currentTarget)}
                onClick={(event) => syncCaret(event.currentTarget)}
                {...(skills.length > 0
                  ? { 'aria-autocomplete': 'list' as const }
                  : {})}
                {...(skillsListed
                  ? {
                      'aria-controls': skillListboxId,
                      'aria-activedescendant': skillOptionId(skillIndex),
                    }
                  : {})}
                onPaste={onPaste}
                {...compositionProps}
                // Leaving the field ends a composition and closes the skills
                // typeahead.
                onBlur={() => {
                  compositionProps.onBlur();
                  setCaret(null);
                }}
                // The placeholder renders as the overlay below so it can carry the
                // Enter-to-send hint; the attribute stays empty.
                placeholder=""
                rows={1}
                disabled={disabled}
                // Chromeless inside the composer's own frame: the field must not
                // draw its own border or focus ring — ring-0 alone still paints the
                // ring OFFSET shadow as a faint outline, so the offset goes to 0
                // with it.
                className={cn(
                  THREAD_COMPOSER_FIELD_CLASS,
                  'text-foreground placeholder:text-muted-foreground relative resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
                )}
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
                    <span aria-hidden="true">{tDialogs('toSend')}</span>
                    <span className="sr-only">{tDialogs('enterToSend')}</span>
                  </span>
                </Text>
              )}
              {skillPickerOpen && skillToken !== null && (
                <TypeaheadListbox
                  listboxId={skillListboxId}
                  optionId={skillOptionId}
                  label={t('skillPicker.listLabel')}
                  emptyLabel={t('skillPicker.empty', {
                    query: skillToken.query,
                  })}
                  options={skillMatches.map((skill) => {
                    const caption = [
                      skill.description,
                      skill.explicitOnly === true
                        ? t('skillPicker.explicitOnly')
                        : undefined,
                    ]
                      .filter((line) => line !== undefined && line !== '')
                      .join(' · ');
                    return {
                      key: skill.slug,
                      name: `/${skill.slug}`,
                      ...(caption !== '' ? { caption } : {}),
                      leading: (
                        <BookOpen
                          aria-hidden
                          className="text-muted-foreground size-4 shrink-0"
                        />
                      ),
                    };
                  })}
                  highlight={skillIndex}
                  onPick={pickSkill}
                  onHighlight={setSkillHighlight}
                />
              )}
              {/* How many skills the typed name finds, for a screen reader:
              the list itself is reached through the field. */}
              <span role="status" aria-live="polite" className="sr-only">
                {skillPickerOpen
                  ? t('skillPicker.count', { count: skillMatches.length })
                  : ''}
              </span>
            </div>

            <Row
              gap={2}
              justify="between"
              align="center"
              className={THREAD_COMPOSER_TOOLBAR_CLASS}
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
                  {...(skills.length > 0 ? { onUseSkill: startSkillPick } : {})}
                  disabled={disabled}
                />
                <ComposerSelectionPicker
                  models={models}
                  {...(subscriptionProviders !== undefined
                    ? { subscriptionProviders }
                    : {})}
                  selection={selection}
                  onSelectionChange={onSelectionChange}
                  skills={skills}
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
                  lang={speechLang}
                  disabled={disabled}
                  onTranscript={handleTranscript}
                  onTranscriptionUnavailable={onTranscriptionUnavailable}
                  {...(organizationId !== undefined ? { organizationId } : {})}
                  {...(transcriptionAvailable !== undefined
                    ? { transcriptionAvailable }
                    : {})}
                  transcriptionUnavailableReason={
                    transcriptionUnavailableReason
                  }
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
                      // Round like the send button it replaces; the primary
                      // variant owns the focus ring (inset, in the fill's ink).
                      className="rounded-full"
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
