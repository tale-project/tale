/**
 * The optimistic send overlay: the user's bubble and the assistant "thinking"
 * shell that appear the moment Send is pressed, before the server has written
 * anything.
 *
 * The server writes the real rows only after guardrails and context assembly
 * run, so without the overlay a send reads as a dead gap: the composer clears
 * and nothing happens for a round-trip or two. The overlay closes it — and
 * the thread-view merge later ADOPTS the real rows into the overlay's React
 * keys (`pending-*` stays the key forever), so the handoff is invisible: same
 * DOM nodes, no remount, the thinking shell becomes the streaming reply in
 * place.
 */

import type { ChatMessageItem } from '../types';

/** One image riding the optimistic bubble — the same narrow projection the
 * turn request carries, so the overlay renders exactly what was sent. */
export interface PendingAttachment {
  readonly fileId: string;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
}

export interface PendingSend {
  /** The optimistic user row's key — and, after adoption, the real row's. */
  readonly key: string;
  /** The assistant shell's key — inherited by the real placeholder row. */
  readonly shellKey: string;
  /** What was sent — also the adoption match: the real user row carrying
   * exactly this text claims the overlay's key. */
  readonly text: string;
  /** The images the send carried — rendered on the optimistic bubble so
   * they appear WITH the text, not a round-trip later. */
  readonly attachments?: readonly PendingAttachment[];
  readonly sentAt: number;
  /** The thread the send targets. A fresh chat starts without one; the send
   * path fills it in as soon as the created thread's id is known. */
  readonly threadId?: string;
  /**
   * Rows at or below this sequence existed before the send — they can never
   * adopt the overlay, so re-sending text that already sits in the thread
   * still shows its own optimistic bubble.
   */
  readonly baselineSequence: number;
  /** Set when the send came from edit-and-branch: the view holds the parent
   * thread's transcript while the branch loads (the swap machinery reads
   * this). */
  readonly editedFromThreadId?: string;
}

export function createPendingSend(args: {
  text: string;
  attachments?: readonly PendingAttachment[];
  sentAt: number;
  threadId?: string;
  baselineSequence: number;
  editedFromThreadId?: string;
}): PendingSend {
  return {
    key: `pending-${args.sentAt}`,
    shellKey: `pending-assistant-${args.sentAt}`,
    text: args.text,
    ...(args.attachments !== undefined && args.attachments.length > 0
      ? { attachments: args.attachments }
      : {}),
    sentAt: args.sentAt,
    ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
    baselineSequence: args.baselineSequence,
    ...(args.editedFromThreadId !== undefined
      ? { editedFromThreadId: args.editedFromThreadId }
      : {}),
  };
}

/** The highest real sequence currently rendered — the send captures it so
 * only rows written AFTER the send can adopt the overlay. */
export function baselineSequenceOf(items: readonly ChatMessageItem[]): number {
  let max = -1;
  for (const item of items) {
    if (item.isPendingShell === true) continue;
    if (item.sequence > max) max = item.sequence;
  }
  return max;
}

/** The optimistic user bubble. The giant sequence keeps it ordered last and
 * outside every sequence-keyed lookup (fork groups). Its parts mirror what
 * the turn will persist — text plus one attachment part per image — so the
 * bubble the user sees IS the bubble the real row becomes. */
export function buildPendingUserItem(pending: PendingSend): ChatMessageItem {
  return {
    id: pending.key,
    key: pending.key,
    role: 'user',
    parts: [
      { type: 'text', text: pending.text },
      ...(pending.attachments ?? []).map(
        (attachment) =>
          ({
            type: 'attachment',
            name: attachment.fileName,
            mediaType: attachment.fileType,
            fileId: attachment.fileId,
            sizeBytes: attachment.fileSize,
          }) as const,
      ),
    ],
    sequence: Number.MAX_SAFE_INTEGER - 1,
    createdAt: pending.sentAt,
    text: pending.text,
    isStreaming: false,
    isFinalReveal: false,
    isPendingShell: true,
  };
}

/** The assistant "thinking" shell under the pending user bubble. */
export function buildPendingShellItem(pending: PendingSend): ChatMessageItem {
  return {
    id: pending.shellKey,
    key: pending.shellKey,
    role: 'assistant',
    parts: [],
    sequence: Number.MAX_SAFE_INTEGER,
    createdAt: pending.sentAt,
    text: '',
    isStreaming: true,
    isFinalReveal: false,
    isPendingShell: true,
  };
}
