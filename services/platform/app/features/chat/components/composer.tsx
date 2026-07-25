'use client';

/**
 * The composer: the message field and the controls that decide how the
 * message is sent — the `+` mode menu, the agent picker, and the model
 * picker, plus dictation and send/stop.
 *
 * Which agent runs the turn also decides WHERE it runs, so there is no sandbox
 * toggle: the platform agent runs a model directly and picks among every
 * model; a third-party agent runs in a sandbox on a directly-served org model
 * (the picker narrows to what the managed lane can mint a session key for)
 * and adds the conversation's capability assembly beside it.
 *
 * Send and stop are the same slot, because a thread is either taking input
 * or producing output: while a turn is in flight the button stops it, and
 * the field keeps accepting text for the next one.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ArrowUp, CircleStop } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { EnterKeyIcon } from '@/app/components/icons/enter-key-icon';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

import type {
  ComposerCapabilityOption,
  ComposerModelOption,
  ComposerExternalAgentOption,
  ComposerSelection,
} from '../types';
import { ComposerAgentPicker } from './composer-agent-picker';
import { ComposerCapabilityMenu } from './composer-capability-menu';
import { ComposerModeMenu } from './composer-mode-menu';
import {
  ComposerModelPicker,
  directServedModels,
  resolveExternalModelId,
} from './composer-model-picker';
import {
  DictationButton,
  type DictationButtonHandle,
} from './dictation-button';

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

interface ComposerProps {
  models: readonly ComposerModelOption[];
  /** Third-party external agents (sandbox harnesses). */
  externalAgents: readonly ComposerExternalAgentOption[];
  /** Harness slugs the circuit breaker flags as recently failing. */
  degradedHarnesses?: ReadonlySet<string>;
  /** What a conversation can equip an external agent with. */
  skills: readonly ComposerCapabilityOption[];
  connectors: readonly ComposerCapabilityOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  /** A turn is in flight — the send button becomes stop. */
  generating?: boolean;
  disabled?: boolean;
  /**
   * Sending alone is blocked — no model picked yet, a turn already running —
   * while typing and the pickers stay usable, so the user can fix the reason
   * instead of facing a fully locked composer.
   */
  sendDisabled?: boolean;
  /** The thread's agent is fixed — lock the agent picker but leave the model
   * / capability controls usable within that agent. */
  lockAgent?: boolean;
}

export function Composer({
  models,
  externalAgents,
  degradedHarnesses,
  skills,
  connectors,
  selection,
  onSelectionChange,
  onSend,
  onStop,
  generating = false,
  disabled = false,
  sendDisabled = false,
  lockAgent = false,
}: ComposerProps) {
  const { t } = useT('chat');
  const { t: tDialogs } = useT('dialogs');
  const { i18n } = useTranslation();
  const [text, setText] = useState('');
  const dictationRef = useRef<DictationButtonHandle>(null);

  const speechLang = toBcp47(i18n.language) ?? 'en-US';

  // The external lane offers only the models the managed lane can actually
  // run, and displays the one the turn WOULD use — the explicit pick when it
  // is direct-served, else the first that is — so the trigger never shows a
  // model the sandbox could not mint a key for.
  const externalModels = useMemo(() => directServedModels(models), [models]);
  const externalSelection = useMemo(() => {
    const modelId = resolveExternalModelId(selection, models);
    return modelId === undefined ? selection : { ...selection, modelId };
  }, [selection, models]);

  const canSend = text.trim().length > 0 && !disabled && !sendDisabled;

  const submit = () => {
    if (!canSend) return;
    // The mic stops on send — it must not keep listening into the next turn.
    dictationRef.current?.stop();
    onSend(text.trim());
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line — the convention every
    // message field in the product follows.
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const handleTranscript = (transcript: string) => {
    setText((previous) => {
      const separator =
        previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
      return previous + separator + transcript;
    });
  };

  return (
    <Stack
      gap={2}
      aria-label={t('aria.chatRegion')}
      as="section"
      // Soft top shadow lifts the composer off the conversation above it.
      className="border-border sm:border-muted-foreground/50 bg-background relative mx-auto w-full max-w-3xl rounded-xl border px-3 pt-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:pt-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]"
    >
      <div className="relative">
        <Textarea
          // The field sits under a visible section, so its name is carried by
          // `aria-label` rather than a label that would duplicate the chrome.
          aria-label={t('aria.chatInput')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
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
        {text.length === 0 && !disabled && (
          <Text
            as="div"
            variant="muted"
            className="pointer-events-none absolute top-0 right-0 left-0 flex items-center gap-1"
          >
            <span className="truncate">{t('typeMessageHere')}</span>
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
            voiceOutput={selection.voiceOutput}
            onVoiceOutputChange={(next) =>
              onSelectionChange({ ...selection, voiceOutput: next })
            }
            disabled={disabled}
          />
          <ComposerAgentPicker
            externalAgents={externalAgents}
            selection={selection}
            onSelectionChange={onSelectionChange}
            disabled={disabled || lockAgent}
            {...(degradedHarnesses !== undefined ? { degradedHarnesses } : {})}
          />
          {selection.agentKind === 'platform' ? (
            <ComposerModelPicker
              models={models}
              selection={selection}
              onSelectionChange={onSelectionChange}
              disabled={disabled}
            />
          ) : (
            <>
              <ComposerModelPicker
                models={externalModels}
                selection={externalSelection}
                onSelectionChange={onSelectionChange}
                disabled={disabled}
              />
              {/* An external agent is also equipped per conversation: org
                  skills and enabled connectors, provisioned into its sandbox
                  session. */}
              <ComposerCapabilityMenu
                skills={skills}
                connectors={connectors}
                selection={selection}
                onSelectionChange={onSelectionChange}
                disabled={disabled}
              />
            </>
          )}
        </Row>

        <Row gap={1} align="center" className="shrink-0">
          <DictationButton
            ref={dictationRef}
            disabled={disabled}
            lang={speechLang}
            onTranscript={handleTranscript}
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
            ) : (
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
            )}
          </span>
        </Row>
      </Row>
    </Stack>
  );
}
