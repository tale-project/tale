'use client';

/**
 * The composer: the message field and the controls that decide how the
 * message is sent — the `+` mode menu, the agent picker, and (for the platform
 * agent) the model picker, plus send/stop.
 *
 * Which agent runs the turn also decides WHERE it runs, so there is no sandbox
 * toggle: the platform agent runs a model directly and shows a model picker; a
 * third-party coding agent runs in a sandbox and brings its own model, so it
 * shows a hint instead of a model picker.
 *
 * Send and stop are the same slot, because a thread is either taking input
 * or producing output: while a turn is in flight the button stops it, and
 * the field keeps accepting text for the next one.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Send, Square } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

import type {
  ComposerModelOption,
  ComposerSandboxAgentOption,
  ComposerSelection,
} from '../types';
import { ComposerAgentPicker } from './composer-agent-picker';
import { ComposerModeMenu } from './composer-mode-menu';
import { ComposerModelPicker } from './composer-model-picker';

interface ComposerProps {
  models: readonly ComposerModelOption[];
  /** Third-party coding agents (sandbox harnesses). */
  sandboxAgents: readonly ComposerSandboxAgentOption[];
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
}

export function Composer({
  models,
  sandboxAgents,
  selection,
  onSelectionChange,
  onSend,
  onStop,
  generating = false,
  disabled = false,
  sendDisabled = false,
}: ComposerProps) {
  const { t } = useT('chat');
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0 && !disabled && !sendDisabled;

  const submit = () => {
    if (!canSend) return;
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

  return (
    <Stack
      gap={2}
      aria-label={t('aria.chatRegion')}
      as="section"
      className="border-border bg-background mx-auto w-full max-w-3xl shrink-0 rounded-lg border p-2"
    >
      <Textarea
        // The field sits under a visible section, so its name is carried by
        // `aria-label` rather than a label that would duplicate the chrome.
        aria-label={t('aria.chatInput')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('typeMessageHere')}
        disabled={disabled}
        rows={2}
        // Chromeless inside the composer's own frame: the field must not draw
        // its own border or focus ring — ring-0 alone still paints the ring
        // OFFSET shadow as a faint outline, so the offset goes to 0 with it.
        className="resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      <Row gap={2} justify="between" align="center" className="min-w-0">
        <Row gap={1} align="center" className="min-w-0">
          <ComposerModeMenu
            voiceOutput={selection.voiceOutput}
            onVoiceOutputChange={(next) =>
              onSelectionChange({ ...selection, voiceOutput: next })
            }
            disabled={disabled}
          />
          <ComposerAgentPicker
            codingAgents={sandboxAgents}
            selection={selection}
            onSelectionChange={onSelectionChange}
            disabled={disabled}
          />
          {selection.agentKind === 'platform' ? (
            <ComposerModelPicker
              models={models}
              selection={selection}
              onSelectionChange={onSelectionChange}
              disabled={disabled}
            />
          ) : (
            // A coding agent runs in a sandbox and brings its own model; that
            // lane is not wired yet, so say so where the model picker would be.
            <Text variant="muted" className="truncate text-sm">
              {t('agentSelector.codingUnavailable')}
            </Text>
          )}
        </Row>

        {generating ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onStop}
            aria-label={t('stopGenerating')}
          >
            <Square aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button
            variant="primary"
            size="icon"
            onClick={submit}
            disabled={!canSend}
            aria-label={t('send')}
          >
            <Send aria-hidden className="size-4" />
          </Button>
        )}
      </Row>
    </Stack>
  );
}
