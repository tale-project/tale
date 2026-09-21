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
 * - The live row's PARTS the stream channel carried (a tool round's text,
 *   calls and results, reasoning segments): the settled rounds' text and
 *   reasoning are read from them (the transcript is refetched only at
 *   settle), and they are held through the same settle gap, so the thought
 *   timeline drawn from them never collapses for the round-trip between the
 *   generation row's delete and the finalized row's arrival.
 * - IDENTITY: rows keep their previous object reference unless a field a
 *   component renders actually changed, and the array itself keeps its
 *   reference when no row changed — so a streamed chunk re-renders exactly
 *   one bubble.
 *
 * Pure data in, pure data out (state is an explicit argument) — no React, no
 * Convex — so the whole contract runs in a unit test.
 */

import type { MessagePart } from '@/lib/chat/types';

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
  /** The assistant row's parts mid-turn — how a tool call reaches the
   *  transcript before the turn settles. */
  readonly parts?: readonly MessagePart[];
  /** The backend clock at emit — anchors the synthesized live row's thinking
   * timer when no optimistic send provides a client-frame anchor. */
  readonly serverNow?: number;
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
  /** Last streamed parts per live row — the same settle-gap bridge as the
   * text, for the thought timeline the parts draw. */
  streamPartsByKey: Map<string, readonly MessagePart[]>;
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
  /**
   * Live rows synthesized from the stream channel, by REAL message id. The
   * transcript is only refetched at settle, so mid-turn the stream is the
   * row's only source — an entry lives from the first `progress` event
   * naming the id until the refetched row renders under the same key.
   */
  syntheticMetaById: Map<
    string,
    { createdAt: number; parts?: readonly MessagePart[] }
  >;
}

export function createThreadViewState(): ThreadViewState {
  return {
    itemsByKey: new Map(),
    lastItems: [],
    heldGeneration: null,
    hasGeneration: false,
    streamTextByKey: new Map(),
    streamReasoningByKey: new Map(),
    streamPartsByKey: new Map(),
    drainedKeys: new Set(),
    realToPendingKey: new Map(),
    adoptedPendingKeys: new Set(),
    adoptedShellKeys: new Set(),
    syntheticMetaById: new Map(),
  };
}

/**
 * The view-swap hold decision. Flipping the rendered sibling under the same
 * lineage root (edit, retry, the ‹ n/m › navigator) tears down one message
 * subscription and opens another — for a round-trip the new view is loading
 * and empty. Serving the PREVIOUS sibling's rows through that gap (plus any
 * optimistic overlay rows the new view already carries) keeps the transcript
 * on screen; the skeleton is reserved for a genuinely first open.
 */
export function resolveHeldItems(opts: {
  readonly loading: boolean;
  readonly currentItems: readonly ChatMessageItem[];
  readonly heldItems: readonly ChatMessageItem[] | undefined;
}): readonly ChatMessageItem[] | undefined {
  if (!opts.loading || opts.heldItems === undefined) return undefined;
  const overlay = opts.currentItems.filter(
    (item) => item.isPendingShell === true,
  );
  if (opts.currentItems.length > overlay.length) return undefined;
  return overlay.length > 0 ? [...opts.heldItems, ...overlay] : opts.heldItems;
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

/** The settled reasoning parts' text, joined in authored order — a tool
 * loop settles one reasoning part per round. */
function reasoningOfParts(
  parts: readonly ChatMessageView['parts'][number][],
): string | undefined {
  const pieces: string[] = [];
  for (const part of parts) {
    if (part.type === 'reasoning' && part.text.length > 0) {
      pieces.push(part.text);
    }
  }
  return pieces.length > 0 ? pieces.join('\n\n') : undefined;
}

/** The row's settled text joined with the live tail. During a tool loop the
 * earlier rounds' text lives on the row's PARTS while the current round
 * streams through the generation channel — the reader sees both, in order. */
function combineSettledAndLive(rowText: string, live: string): string {
  if (rowText.length === 0) return live;
  if (live.length === 0) return rowText;
  return `${rowText}\n\n${live}`;
}

/** The last settled part text of one kind, for the stale-live check. */
function lastPartText(
  parts: readonly ChatMessageView['parts'][number][],
  type: 'text' | 'reasoning',
): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part !== undefined && part.type === type && part.text.length > 0) {
      return part.text;
    }
  }
  return '';
}

/**
 * True when the live channel still carries (a prefix of) text that ALREADY
 * settled onto the row — the finalize race, where the parts landed before
 * the generation row was deleted. A tool-round tail is fresh text the last
 * settled segment does not begin with, so it never reads as stale.
 */
function liveIsStale(lastSettledSegment: string, live: string): boolean {
  return live.length > 0 && lastSettledSegment.startsWith(live);
}

/** A row is settled once the finalize (or a failure stamp) landed: it carries
 * text, an error, a guardrail block, or usage — or a terminal status (a stop
 * before the first token stamps `cancelled` and nothing else). An empty
 * assistant row with none of those is a placeholder a turn is still
 * writing. */
function isSettledRow(row: ChatMessageView, rowText: string): boolean {
  return (
    rowText.length > 0 ||
    row.blockedReason !== undefined ||
    row.usage !== undefined ||
    isTerminalRow(row)
  );
}

/** The row's own terminal state: the finalize stamped an error or a status
 * other than `pending`. Such a row is never presented as streaming again —
 * not even while a generation row that outlived its settle still names it —
 * and its own content is authoritative over anything this mount streamed. */
function isTerminalRow(row: ChatMessageView): boolean {
  return (
    row.error !== undefined ||
    row.status === 'complete' ||
    row.status === 'failed' ||
    row.status === 'cancelled'
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
  const renderedRowIds = new Set<string>();

  for (const row of messages) {
    const key = state.realToPendingKey.get(row.id) ?? row.id;
    renderedRowIds.add(row.id);
    const rowText = messagePlainText(row.parts);
    const settled = isSettledRow(row, rowText);

    let text = rowText;
    let reasoningText = reasoningOfParts(row.parts);
    let isStreaming = false;
    // The live row's parts, when the stream is ahead of the transcript. The
    // transcript is refetched only at settle, so without this a tool call
    // stays invisible for the whole turn — which is what shipped.
    let liveParts: readonly MessagePart[] | undefined;

    if (targetId === row.id && !isTerminalRow(row)) {
      // The live row. Parts first: the stream channel carries the row's
      // parts as they land mid-turn (a tool round's text, calls and
      // results) while the transcript is refetched only at settle, and
      // parts only ever grow within a turn — so the longer list is the
      // newer one, and preferring the row on a tie keeps the settle write
      // (which carries the full tool results) authoritative the moment it
      // lands. Held like the text: the channel goes idle one round-trip
      // before the finalized row arrives, and the thought timeline drawn
      // from these parts must not collapse for that gap.
      const heldParts = state.streamPartsByKey.get(key);
      const streamedParts = generationText?.parts;
      const newestParts =
        streamedParts !== undefined &&
        (heldParts === undefined || streamedParts.length >= heldParts.length)
          ? streamedParts
          : heldParts;
      if (newestParts !== undefined) {
        state.streamPartsByKey.set(key, newestParts);
        if (newestParts.length > row.parts.length) liveParts = newestParts;
      }
      // The settled rounds are read from the SAME parts the row renders. An
      // earlier round's text sits on the channel's parts long before the
      // refetched row carries it; reading it from the row alone kept that
      // paragraph invisible until settle, when it popped in above the
      // streaming answer and remounted everything beneath it.
      const settledParts = liveParts ?? row.parts;
      const settledText = messagePlainText(settledParts);
      const settledReasoning = reasoningOfParts(settledParts);

      // Its text is the settled rounds' text plus the stream channel's tail
      // (the current round); held so a loading gap or the settle race never
      // blanks the bubble, and clamped so it never shrinks mid-stream.
      const held = state.streamTextByKey.get(key) ?? '';
      const live = generationText?.text ?? '';
      const freshLive = liveIsStale(lastPartText(settledParts, 'text'), live)
        ? ''
        : live;
      const candidate = combineSettledAndLive(settledText, freshLive);
      text = candidate.length >= held.length ? candidate : held;
      state.streamTextByKey.set(key, text);

      const heldReasoning = state.streamReasoningByKey.get(key);
      const liveReasoningRaw = generationText?.reasoning;
      const liveReasoning =
        liveReasoningRaw !== undefined &&
        liveIsStale(lastPartText(settledParts, 'reasoning'), liveReasoningRaw)
          ? undefined
          : liveReasoningRaw;
      const combinedReasoning =
        settledReasoning !== undefined || liveReasoning !== undefined
          ? combineSettledAndLive(settledReasoning ?? '', liveReasoning ?? '')
          : undefined;
      reasoningText =
        combinedReasoning !== undefined &&
        (heldReasoning === undefined ||
          combinedReasoning.length >= heldReasoning.length)
          ? combinedReasoning
          : heldReasoning;
      if (reasoningText !== undefined) {
        state.streamReasoningByKey.set(key, reasoningText);
      }
      isStreaming = true;
    } else if (state.streamTextByKey.has(key)) {
      // A row this mount streamed, no longer targeted by a live generation.
      const held = state.streamTextByKey.get(key) ?? '';
      reasoningText = reasoningText ?? state.streamReasoningByKey.get(key);
      if (settled && (rowText.length >= held.length || isTerminalRow(row))) {
        // Finalized: the row's own content caught up with everything that
        // streamed, so it is authoritative from here on. (During a tool
        // loop's settle gap the row already carries EARLIER rounds' text
        // while the final round's tail exists only in `held` — the length
        // guard keeps the tail on screen until the finalize write lands. A
        // terminal row is authoritative even when it kept LESS than
        // streamed: a failure mid-stream settles what the server wrote,
        // never a tail it refused — holding that tail as "streaming" is how
        // a failed reply kept thinking forever.)
        state.streamTextByKey.delete(key);
        state.streamPartsByKey.delete(key);
        state.drainedKeys.add(key);
      } else {
        // The generation row is gone but the finalize write has not landed
        // yet — keep the streamed text, the streamed parts and the streaming
        // presentation for the gap instead of blanking the bubble or
        // collapsing the thought timeline under the answer (the placeholder
        // row's own parts are still empty here).
        text = held;
        const heldParts = state.streamPartsByKey.get(key);
        if (heldParts !== undefined && heldParts.length > row.parts.length) {
          liveParts = heldParts;
        }
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
      ...(liveParts !== undefined ? { parts: liveParts } : {}),
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
  // The live row, synthesized while the transcript does not carry it. The
  // message list is only refetched at settle, so on a fresh send the
  // placeholder row exists server-side while `messages` still predates it —
  // without this the streamed text has no row to land on and the whole
  // reply pops in at settle. The stream channel names the row (`messageId`)
  // and carries its text/reasoning/parts; render from that, keyed the way
  // the real row will be, so the refetch hands over held text and reveal
  // in place.
  if (targetId !== undefined && !renderedRowIds.has(targetId)) {
    // Inherit the shell's key while an un-adopted overlay is up — the same
    // in-place handoff the real placeholder gets, and the shell push below
    // stays down for it. Adoption proper (and `pendingConsumed`) still
    // waits for the real rows, so the optimistic user bubble stays up.
    if (
      pending &&
      !state.adoptedShellKeys.has(pending.shellKey) &&
      !state.realToPendingKey.has(targetId)
    ) {
      state.realToPendingKey.set(targetId, pending.shellKey);
    }
    const key = state.realToPendingKey.get(targetId) ?? targetId;
    const meta = state.syntheticMetaById.get(targetId) ?? {
      createdAt: pending?.sentAt ?? generationText?.serverNow ?? 0,
    };
    const streamedParts = generationText?.parts;
    if (
      streamedParts !== undefined &&
      streamedParts.length >= (meta.parts?.length ?? 0)
    ) {
      meta.parts = streamedParts;
    }
    // The real row can arrive in the same pass the turn settles; the hold
    // is what carries the timeline across that handover.
    if (meta.parts !== undefined) state.streamPartsByKey.set(key, meta.parts);
    state.syntheticMetaById.set(targetId, meta);
    // Text and reasoning composed exactly as for a real live row: the
    // settled rounds from the parts, then the channel's tail.
    const settledParts = meta.parts ?? [];
    const held = state.streamTextByKey.get(key) ?? '';
    const live = generationText?.text ?? '';
    const freshLive = liveIsStale(lastPartText(settledParts, 'text'), live)
      ? ''
      : live;
    const candidate = combineSettledAndLive(
      messagePlainText(settledParts),
      freshLive,
    );
    state.streamTextByKey.set(
      key,
      candidate.length >= held.length ? candidate : held,
    );
    const heldReasoning = state.streamReasoningByKey.get(key);
    const settledReasoning = reasoningOfParts(settledParts);
    const liveReasoningRaw = generationText?.reasoning;
    const liveReasoning =
      liveReasoningRaw !== undefined &&
      liveIsStale(lastPartText(settledParts, 'reasoning'), liveReasoningRaw)
        ? undefined
        : liveReasoningRaw;
    const combinedReasoning =
      settledReasoning !== undefined || liveReasoning !== undefined
        ? combineSettledAndLive(settledReasoning ?? '', liveReasoning ?? '')
        : undefined;
    if (
      combinedReasoning !== undefined &&
      (heldReasoning === undefined ||
        combinedReasoning.length >= heldReasoning.length)
    ) {
      state.streamReasoningByKey.set(key, combinedReasoning);
    }
  }
  // Materialize the synthesized rows — held through the settle gap even
  // after the generation goes idle — and retire each one the pass its real
  // row renders (that row inherits the key, so the drain branch above
  // carries the reveal from there).
  for (const [id, meta] of state.syntheticMetaById) {
    if (renderedRowIds.has(id)) {
      state.syntheticMetaById.delete(id);
      continue;
    }
    const key = state.realToPendingKey.get(id) ?? id;
    const reasoningText = state.streamReasoningByKey.get(key);
    const item: ChatMessageItem = {
      id,
      key,
      role: 'assistant',
      parts: meta.parts ?? [],
      sequence: Number.MAX_SAFE_INTEGER,
      createdAt: meta.createdAt,
      text: state.streamTextByKey.get(key) ?? '',
      ...(reasoningText !== undefined ? { reasoningText } : {}),
      isStreaming: true,
      isFinalReveal: false,
      isPendingShell: true,
    };
    const prior = state.itemsByKey.get(key);
    const kept = prior && chatItemRenderEqual(prior, item) ? prior : item;
    next.push(kept);
    nextByKey.set(kept.key, kept);
  }
  if (
    pending &&
    !state.adoptedShellKeys.has(pending.shellKey) &&
    !nextByKey.has(pending.shellKey)
  ) {
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
