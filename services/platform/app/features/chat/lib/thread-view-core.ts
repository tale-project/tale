/**
 * The pure merge behind the conversation view: message list + live generation
 * + streamed in-flight text → render-ready rows.
 *
 * Owns the facts the rows render from:
 *
 * - WHICH row is live (`isStreaming`), latched: derived from the generation
 *   row's existence, and a transient subscription gap (a cache-less read
 *   re-entering `loading` on remount) serves the last known value instead of
 *   flapping the flag off mid-stream.
 * - The live row's TEXT, which lives on the generation row while the message
 *   row's own parts stay empty; it never shrinks mid-stream (a reconnect can
 *   deliver a shorter committed prefix), and it survives the settle gap where
 *   the generation row is already gone but the finalize write has not landed.
 * - IDENTITY: rows keep their previous object reference unless a field a
 *   component renders actually changed, and the array itself keeps its
 *   reference when no row changed — so a streamed chunk re-renders exactly
 *   one bubble.
 *
 * Pure data in, pure data out (state is an explicit argument) — no React, no
 * Convex — so the whole contract runs in a unit test.
 */

import type {
  ChatGenerationView,
  ChatMessageItem,
  ChatMessageView,
} from '../types';
import { chatItemRenderEqual } from '../utils/message-equality';
import {
  buildPendingShellItem,
  buildPendingUserItem,
  type PendingSend,
} from '../utils/pending-messages';
import { messagePlainText } from './message-text';

/** The in-flight text channel, as `getGenerationText` returns it. */
export interface GenerationTextView {
  readonly messageId?: string;
  readonly text: string;
  readonly reasoning?: string;
}

/** What the reducer consumes each render. `undefined` = that subscription is
 * still loading; the reducer serves held values across those gaps. */
export interface ThreadViewInputs {
  readonly messages: readonly ChatMessageView[] | undefined;
  readonly generation: ChatGenerationView | null | undefined;
  readonly generationText: GenerationTextView | null | undefined;
  /** The in-flight optimistic send targeting this thread, if any. */
  readonly pending?: PendingSend | null;
}

/** The mutable merge state, scoped to one (organization, thread) pair. */
export interface ThreadViewState {
  itemsByKey: Map<string, ChatMessageItem>;
  lastItems: readonly ChatMessageItem[];
  /** Last READY generation value; `hasGeneration` distinguishes "never
   * resolved" from "resolved to idle". */
  heldGeneration: ChatGenerationView | null;
  hasGeneration: boolean;
  /** Last streamed text per live row — bridges both the text query's loading
   * gaps and the settle gap before the finalize write lands. */
  streamTextByKey: Map<string, string>;
  streamReasoningByKey: Map<string, string>;
  /** Rows that finished streaming during this mount — their reveal drains
   * out instead of popping, and settle-gated chrome can wait for it. */
  drainedKeys: Set<string>;
  /** Real row id → the optimistic key it adopted. Permanent for the scope:
   * the bubble keeps its `pending-*` key so the handoff never remounts. */
  realToPendingKey: Map<string, string>;
  /** Optimistic user keys whose real row has arrived. */
  adoptedPendingKeys: Set<string>;
  /** Optimistic shell keys whose real placeholder has arrived. */
  adoptedShellKeys: Set<string>;
}

export function createThreadViewState(): ThreadViewState {
  return {
    itemsByKey: new Map(),
    lastItems: [],
    heldGeneration: null,
    hasGeneration: false,
    streamTextByKey: new Map(),
    streamReasoningByKey: new Map(),
    drainedKeys: new Set(),
    realToPendingKey: new Map(),
    adoptedPendingKeys: new Set(),
    adoptedShellKeys: new Set(),
  };
}

/** Static rows for surfaces without a live turn (a shared snapshot): every
 * message rendered as settled, nothing streaming. */
export function toSettledItems(
  messages: readonly ChatMessageView[],
): ChatMessageItem[] {
  return messages.map((row) => ({
    ...row,
    key: row.id,
    text: messagePlainText(row.parts),
    isStreaming: false,
    isFinalReveal: false,
  }));
}

/** A row is settled once the finalize (or a failure stamp) landed: it carries
 * text, an error, a guardrail block, or usage. An empty assistant row with
 * none of those is a placeholder a turn is still writing. */
function isSettledRow(row: ChatMessageView, rowText: string): boolean {
  return (
    rowText.length > 0 ||
    row.error !== undefined ||
    row.blockedReason !== undefined ||
    row.usage !== undefined
  );
}

/** Which row the live turn is writing: the one the generation names, else the
 * trailing assistant row. */
function resolveStreamingTarget(
  messages: readonly ChatMessageView[],
  generation: ChatGenerationView | null,
  generationText: GenerationTextView | null,
): string | undefined {
  if (!generation) return undefined;
  const named = generation.messageId ?? generationText?.messageId;
  if (named !== undefined) return named;
  const last = messages.at(-1);
  return last?.role === 'assistant' ? last.id : undefined;
}

export interface ThreadViewResult {
  readonly items: readonly ChatMessageItem[];
  readonly generation: ChatGenerationView | null;
  readonly streamingMessageId: string | undefined;
  /** True once the overlay's shell latched onto the real placeholder — the
   * pending state has served its purpose and the sender can drop it. */
  readonly pendingConsumed: boolean;
}

/**
 * Merge one render's inputs into the state and produce the row array. Pure in
 * its inputs (mutates only `state`) and idempotent for identical inputs, so a
 * render-phase call is safe under strict-mode double invocation.
 */
export function reduceThreadView(
  state: ThreadViewState,
  inputs: ThreadViewInputs,
): ThreadViewResult {
  // Latch the generation across loading gaps: only a READY result changes it.
  if (inputs.generation !== undefined) {
    state.heldGeneration = inputs.generation;
    state.hasGeneration = true;
  }
  const generation = state.heldGeneration;
  const generationText = inputs.generationText ?? null;

  const messages = inputs.messages ?? [];
  const targetId = resolveStreamingTarget(messages, generation, generationText);
  const pending = inputs.pending ?? null;

  // Adoption: the real rows the send produced claim the overlay's keys, so
  // the optimistic bubbles become the real ones in place. The user row is
  // matched by text on the LAST user row written after the send's baseline;
  // the shell latches onto the first assistant row after it.
  if (pending && !state.adoptedPendingKeys.has(pending.key)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const row = messages[index];
      if (row === undefined || row.role !== 'user') continue;
      if (
        row.sequence > pending.baselineSequence &&
        messagePlainText(row.parts) === pending.text
      ) {
        state.realToPendingKey.set(row.id, pending.key);
        state.adoptedPendingKeys.add(pending.key);
      }
      break;
    }
  }
  if (
    pending &&
    state.adoptedPendingKeys.has(pending.key) &&
    !state.adoptedShellKeys.has(pending.shellKey)
  ) {
    const adoptedUserIndex = messages.findIndex(
      (row) => state.realToPendingKey.get(row.id) === pending.key,
    );
    if (adoptedUserIndex >= 0) {
      for (
        let index = adoptedUserIndex + 1;
        index < messages.length;
        index += 1
      ) {
        const row = messages[index];
        if (row === undefined || row.role !== 'assistant') continue;
        state.realToPendingKey.set(row.id, pending.shellKey);
        state.adoptedShellKeys.add(pending.shellKey);
        break;
      }
    }
  }

  const next: ChatMessageItem[] = [];
  const nextByKey = new Map<string, ChatMessageItem>();

  for (const row of messages) {
    const key = state.realToPendingKey.get(row.id) ?? row.id;
    const rowText = messagePlainText(row.parts);
    const settled = isSettledRow(row, rowText);

    let text = rowText;
    let reasoningText: string | undefined;
    let isStreaming = false;

    if (targetId === row.id) {
      // The live row. Its text comes from the stream channel until the row's
      // own parts carry it; held so a loading gap or the settle race never
      // blanks the bubble, and clamped so it never shrinks mid-stream.
      const held = state.streamTextByKey.get(key) ?? '';
      const live = generationText?.text ?? '';
      const candidate = rowText.length > 0 ? rowText : live;
      text = candidate.length >= held.length ? candidate : held;
      state.streamTextByKey.set(key, text);

      const heldReasoning = state.streamReasoningByKey.get(key);
      reasoningText = generationText?.reasoning ?? heldReasoning;
      if (reasoningText !== undefined) {
        state.streamReasoningByKey.set(key, reasoningText);
      }
      isStreaming = true;
    } else if (state.streamTextByKey.has(key)) {
      // A row this mount streamed, no longer targeted by a live generation.
      const held = state.streamTextByKey.get(key) ?? '';
      reasoningText = state.streamReasoningByKey.get(key);
      if (settled) {
        // Finalized: the row's own content is authoritative from here on.
        state.streamTextByKey.delete(key);
        state.drainedKeys.add(key);
      } else {
        // The generation row is gone but the finalize write has not landed
        // yet — keep the streamed text and the streaming presentation for
        // the gap instead of blanking the bubble.
        text = held;
        isStreaming = true;
      }
    } else if (
      row.role === 'assistant' &&
      !settled &&
      row.id === messages.at(-1)?.id
    ) {
      // An unsettled trailing placeholder without a generation naming it:
      // the generation read has not resolved yet (thread opened mid-turn),
      // or the turn is between generation-delete and the finalize write.
      // Present it as streaming — the thinking state — never as an empty
      // settled reply.
      isStreaming = true;
    }

    const item: ChatMessageItem = {
      ...row,
      key,
      text,
      ...(reasoningText !== undefined ? { reasoningText } : {}),
      isStreaming,
      isFinalReveal: state.drainedKeys.has(key),
    };

    const prior = state.itemsByKey.get(key);
    const kept = prior && chatItemRenderEqual(prior, item) ? prior : item;
    next.push(kept);
    nextByKey.set(key, kept);
  }

  // The overlay rows, until their real counterparts adopted the keys. The
  // shell shows the thinking state through the whole pre-placeholder gap —
  // guardrails, context assembly, the model's first token.
  if (pending && !state.adoptedPendingKeys.has(pending.key)) {
    const item = buildPendingUserItem(pending);
    const prior = state.itemsByKey.get(item.key);
    const kept = prior && chatItemRenderEqual(prior, item) ? prior : item;
    next.push(kept);
    nextByKey.set(kept.key, kept);
  }
  if (pending && !state.adoptedShellKeys.has(pending.shellKey)) {
    const item = buildPendingShellItem(pending);
    const prior = state.itemsByKey.get(item.key);
    const kept = prior && chatItemRenderEqual(prior, item) ? prior : item;
    next.push(kept);
    nextByKey.set(kept.key, kept);
  }

  state.itemsByKey = nextByKey;
  const allSame =
    next.length === state.lastItems.length &&
    next.every((item, index) => item === state.lastItems[index]);
  const items = allSame ? state.lastItems : next;
  state.lastItems = items;

  return {
    items,
    generation,
    streamingMessageId: targetId,
    pendingConsumed:
      pending !== null && state.adoptedShellKeys.has(pending.shellKey),
  };
}
