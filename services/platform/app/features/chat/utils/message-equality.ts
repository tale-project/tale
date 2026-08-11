/**
 * Render-equality for chat view models.
 *
 * The Convex client materializes a fresh object graph on every push, so
 * during a stream every row and every `parts` array gets a new identity even
 * though only the tail bubble changed. These comparators are the shared
 * definition of "renders the same": the thread-view hook uses them to hand
 * back the PRIOR reference for an unchanged row (so a memoized row bails on
 * the first `===`), and row memo comparators use them for fields that survive
 * reference churn. The two must never drift — a field a row renders that this
 * file does not compare is a stale-render bug.
 */

import type { MessagePart } from '@/lib/chat/types';

import type { ChatMessageItem, ChatMessageUsage } from '../types';

/**
 * Whether two parts render the same. Tool payloads (`input`/`output`) are
 * identified by their `callId` instead of being deep-compared: a call's
 * payload never changes once written — a new payload is a new call.
 * Streamed text parts compare by LENGTH: streaming only ever appends, and a
 * settled row's parts are immutable, so two texts of equal length on the same
 * row are the same text.
 */
export function samePart(a: MessagePart, b: MessagePart): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'text':
      return b.type === 'text' && a.text.length === b.text.length;
    case 'reasoning':
      return b.type === 'reasoning' && a.text.length === b.text.length;
    case 'attachment':
      return (
        b.type === 'attachment' &&
        a.name === b.name &&
        a.mediaType === b.mediaType &&
        a.url === b.url &&
        a.text === b.text
      );
    case 'tool-call':
      return (
        b.type === 'tool-call' &&
        a.callId === b.callId &&
        a.capabilityId === b.capabilityId
      );
    case 'tool-result':
      return (
        b.type === 'tool-result' &&
        a.callId === b.callId &&
        a.capabilityId === b.capabilityId &&
        a.structured === b.structured
      );
    case 'approval':
      return (
        b.type === 'approval' &&
        a.approvalId === b.approvalId &&
        a.question === b.question &&
        a.decision === b.decision
      );
    case 'human-input':
      return (
        b.type === 'human-input' &&
        a.requestId === b.requestId &&
        a.question === b.question &&
        a.questionCount === b.questionCount &&
        // The outcome drives the badge and whether the row renders at all, so
        // a change in it must not compare equal.
        a.outcome === b.outcome
      );
    default: {
      const exhaustive: never = a;
      throw new Error(`unhandled part kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function sameParts(
  a: readonly MessagePart[],
  b: readonly MessagePart[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) return false;
    if (!samePart(left, right)) return false;
  }
  return true;
}

function sameUsage(
  a: ChatMessageUsage | undefined,
  b: ChatMessageUsage | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.totalTokens === b.totalTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.durationMs === b.durationMs &&
    a.timeToFirstTokenMs === b.timeToFirstTokenMs
  );
}

/** Whether two thread-view rows render identically — every field a row
 * component reads, nothing more. `text` compares exactly: it is the one field
 * that changes on the live row while everything else holds. */
export function chatItemRenderEqual(
  a: ChatMessageItem,
  b: ChatMessageItem,
): boolean {
  return (
    a.id === b.id &&
    a.key === b.key &&
    a.role === b.role &&
    a.sequence === b.sequence &&
    a.model === b.model &&
    a.providerSlug === b.providerSlug &&
    a.blockedReason === b.blockedReason &&
    a.error === b.error &&
    a.createdAt === b.createdAt &&
    a.text === b.text &&
    a.reasoningText === b.reasoningText &&
    a.isStreaming === b.isStreaming &&
    a.isFinalReveal === b.isFinalReveal &&
    (a.isPendingShell ?? false) === (b.isPendingShell ?? false) &&
    sameParts(a.parts, b.parts) &&
    sameUsage(a.usage, b.usage)
  );
}
