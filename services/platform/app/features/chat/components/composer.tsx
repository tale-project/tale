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
import { ArrowUp, CircleStop } from 'lucide-react';
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
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { ComposerModelOption, ComposerSelection } from '../types';
import { normalizeCopiedText } from '../utils/normalize-copied-text';
import { ComposerModeMenu } from './composer-mode-menu';
import { ComposerSelectionPicker } from './composer-selection-picker';
import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';
import { QuotedReferenceChip } from './quoted-reference-chip';
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
      disabled = false,
      sendDisabled = false,
      sendBlockedReason,
      quotedText = null,
      onQuotedTextChange,
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
    const canSend =
      text.trim().length > 0 && !disabled && !sendDisabled && !blocked;

    const submit = () => {
      // The user clearly meant to send but a stated reason blocks it: say it.
      // The disabled button shows the reason on hover, but a keyboard Enter
      // would otherwise be a silent no-op that reads as "Enter doesn't work".
      if (text.trim().length > 0 && blocked && !generating) {
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
      // Collapse the blank-line stacks copying rendered chat markdown leaves
      // behind. Only override the native paste when normalization actually
      // changes the text, so ordinary pastes keep their caret + undo.
      const plainText = event.clipboardData.getData('text/plain');
      if (plainText.length === 0) return;
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
      <Stack
        gap={2}
        aria-label={t('aria.chatRegion')}
        as="section"
        // Soft top shadow lifts the composer off the conversation above it.
        className="border-border sm:border-muted-foreground/50 bg-background relative mx-auto w-full max-w-3xl rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]"
      >
        {onQuotedTextChange !== undefined && (
          <QuotedReferenceChip
            quotedText={quotedText}
            onClear={() => onQuotedTextChange(null)}
          />
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
                <Button
                  variant="primary"
                  size="icon"
                  onClick={onStop}
                  aria-label={t('stopGenerating')}
                  className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <CircleStop aria-hidden className="size-4" />
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
    );
  }),
);
