'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import type { ChatMessageItem, MessagePart } from '../types';

type IncompleteMessage = Pick<
  ChatMessageItem,
  | 'role'
  | 'isStreaming'
  | 'error'
  | 'blockedReason'
  | 'text'
  | 'parts'
  | 'status'
  | 'usage'
>;

/**
 * A settled assistant row that never wrote an answer: the turn's rounds were
 * all spent investigating, the model used up its output limit thinking, the
 * provider's filter withheld the reply, or the model simply returned nothing.
 * Errors, guardrail blocks and user stops are explained by their own
 * surfaces; this predicate covers the remaining silent-empty cases.
 *
 * "Settled" is read off the row itself — it ran tools, or it carries the
 * finalize's stamp (`complete`, or the usage the turn booked). An empty row
 * with neither is a placeholder a turn may still be writing, and stays the
 * thinking state.
 */
export function isGenerationIncomplete(message: IncompleteMessage): boolean {
  if (
    message.role !== 'assistant' ||
    message.isStreaming ||
    message.error !== undefined ||
    message.blockedReason !== undefined ||
    message.text.length > 0
  ) {
    return false;
  }
  if (
    message.status === 'cancelled' ||
    message.usage?.finishReason === 'cancelled'
  ) {
    return false;
  }
  return (
    message.status === 'complete' ||
    message.usage !== undefined ||
    message.parts.some((part) => part.type === 'tool-call')
  );
}

/** Which sentence explains the missing answer. */
type IncompleteReason = 'length' | 'filtered' | 'tools' | 'empty';

function incompleteReason(
  parts: readonly MessagePart[],
  finishReason: NonNullable<ChatMessageItem['usage']>['finishReason'],
): IncompleteReason {
  // The cap and the filter explain the silence better than the tools the
  // turn ran on the way there.
  if (finishReason === 'length') return 'length';
  if (finishReason === 'content-filter') return 'filtered';
  return parts.some((part) => part.type === 'tool-call') ? 'tools' : 'empty';
}

/**
 * The answerless-turn warning: one localized line saying why the reply holds
 * no answer, in place of the silence an empty markdown block would leave —
 * and, on the conversation's last reply, the same retry an error offers.
 * Rendered where the answer would have been, so the row explains itself.
 */
export function GenerationIncompleteNotice({
  parts,
  finishReason,
  onRetry,
}: {
  parts: readonly MessagePart[];
  finishReason?: NonNullable<ChatMessageItem['usage']>['finishReason'];
  onRetry?: () => void;
}) {
  const { t } = useT('chat');
  const reason = incompleteReason(parts, finishReason);
  const tools = [
    ...new Set(
      parts
        .filter((part) => part.type === 'tool-call')
        .map((part) => part.capabilityId),
    ),
  ];

  const line =
    reason === 'length'
      ? t('generationIncompleteLength')
      : reason === 'filtered'
        ? t('generationIncompleteFiltered')
        : reason === 'tools'
          ? t('generationIncompleteWithTools', { tools: tools.join(', ') })
          : t('generationIncomplete');

  // The sentence is body text in the muted foreground: the warning hue alone
  // is far below AA contrast on the page, so only the icon carries it.
  return (
    <Stack gap={2} className="py-1" role="status">
      <div className="text-muted-foreground flex items-start gap-2 text-sm">
        <AlertTriangle
          className="text-warning mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>{line}</span>
      </div>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit gap-1.5"
          onClick={onRetry}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {t('retryGeneration')}
        </Button>
      )}
    </Stack>
  );
}
