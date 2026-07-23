'use client';

/**
 * The composer: the message field and the controls that decide how the
 * message is sent — the `+` mode menu, the agent picker, the model picker
 * with its sandbox toggle, and send/stop.
 *
 * Send and stop are the same slot, because a thread is either taking input
 * or producing output: while a turn is in flight the button stops it, and
 * the field keeps accepting text for the next one.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row, Stack } from '@tale/ui/layout';
import { Bot, ChevronDown, Send, Square } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

import type {
  ChatAgentOption,
  ComposerModelOption,
  ComposerSandboxAgentOption,
  ComposerSelection,
} from '../types';
import { ComposerModeMenu } from './composer-mode-menu';
import { ComposerModelPicker } from './composer-model-picker';

interface ComposerProps {
  models: readonly ComposerModelOption[];
  sandboxAgents: readonly ComposerSandboxAgentOption[];
  agents: readonly ChatAgentOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  /** A turn is in flight — the send button becomes stop. */
  generating?: boolean;
  disabled?: boolean;
}

export function Composer({
  models,
  sandboxAgents,
  agents,
  selection,
  onSelectionChange,
  onSend,
  onStop,
  generating = false,
  disabled = false,
}: ComposerProps) {
  const { t } = useT('chat');
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0 && !disabled;

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

  const agentItems = useMemo<DropdownMenuGroup[]>(() => {
    if (agents.length === 0) return [];
    return [
      agents.map((agent) => ({
        type: 'item' as const,
        label: agent.label,
        icon: Bot,
        selected: agent.slug === selection.agentSlug,
        onClick: () =>
          onSelectionChange({
            ...selection,
            agentSlug:
              agent.slug === selection.agentSlug ? undefined : agent.slug,
          }),
      })),
    ];
  }, [agents, selection, onSelectionChange]);

  const selectedAgent = agents.find(
    (agent) => agent.slug === selection.agentSlug,
  );

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
        className="resize-none border-0 shadow-none focus-visible:ring-0"
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
          {agentItems.length > 0 && (
            <DropdownMenu
              align="start"
              disabled={disabled}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('agentSelector.label')}
                  aria-haspopup="menu"
                  className="min-w-0"
                >
                  <span className="truncate">
                    {selectedAgent?.label ?? t('agentSelector.defaultAgent')}
                  </span>
                  <ChevronDown aria-hidden className="size-3.5 shrink-0" />
                </Button>
              }
              items={agentItems}
            />
          )}
          <ComposerModelPicker
            models={models}
            sandboxAgents={sandboxAgents}
            selection={selection}
            onSelectionChange={onSelectionChange}
            disabled={disabled}
          />
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
