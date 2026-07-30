'use client';

import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import type { ChatMessageItem, MessagePart } from '../types';

/**
 * A settled assistant row that ran tools but never wrote an answer — the
 * turn's rounds were all spent investigating. Errors, guardrail blocks, and
 * user stops are explained by their own surfaces; this predicate covers the
 * one remaining silent-empty case.
 */
export function isGenerationIncomplete(
  message: Pick<
    ChatMessageItem,
    'role' | 'isStreaming' | 'error' | 'blockedReason' | 'text' | 'parts'
  >,
): boolean {
  return (
    message.role === 'assistant' &&
    !message.isStreaming &&
    message.error === undefined &&
    message.blockedReason === undefined &&
    message.text.length === 0 &&
    message.parts.some((part) => part.type === 'tool-call')
  );
}

/**
 * The answerless-turn warning: one localized line naming the tools the turn
 * ran, in place of the silence an empty markdown block would leave. Rendered
 * where the answer would have been, so the row still explains itself.
 */
export function GenerationIncompleteNotice({
  parts,
}: {
  parts: readonly MessagePart[];
}) {
  const { t } = useT('chat');
  const tools = [
    ...new Set(
      parts
        .filter((part) => part.type === 'tool-call')
        .map((part) => part.capabilityId),
    ),
  ];

  const line =
    tools.length > 0
      ? t('generationIncompleteWithTools', { tools: tools.join(', ') })
      : t('generationIncomplete');

  return (
    <div className="text-warning flex items-center gap-1.5 py-1 text-xs">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}
