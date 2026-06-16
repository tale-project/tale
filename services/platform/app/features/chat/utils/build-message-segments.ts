/**
 * Derives an ORDERED, interleaved render plan from a UIMessage's `parts`.
 *
 * Where {@link ./build-thought-timeline} extracts ONLY reasoning + tool steps
 * (dropping text) for the legacy hoisted timeline, this walker preserves the
 * full chronological sequence — text, reasoning, and tool segments in the order
 * the model emitted them — so the bubble can render thinking and tool activity
 * INLINE, between chunks of answer text, instead of in one block up front.
 *
 * The agent SDK appends parts chronologically and only opens a new `text` part
 * after a non-text interruption (a reasoning block or tool call), so two text
 * segments are never adjacent unless something happened between them; we still
 * coalesce adjacent text defensively. Narrowing is property-based (not trusting
 * the discriminant) to match the defensive style of the timeline builder.
 */

import { isRecord } from '@/lib/utils/type-guards';

import {
  SKILL_TOOL_NAMES,
  toToolState,
  type ThoughtStep,
} from './thought-step-types';

/** A streamed answer-text run between (or before/after) thought activity. */
export interface TextSegment {
  kind: 'text';
  id: string;
  text: string;
  state: 'streaming' | 'done';
  /** The final text run of the message — it owns the live typewriter (the only
   *  segment allowed to stream) and carries the trailing `[[NEXT_STEPS]]`
   *  marker. Exactly one text segment is `isLast` when any text exists. */
  isLast: boolean;
}

export type MessageSegment =
  | TextSegment
  | Extract<ThoughtStep, { kind: 'reasoning' }>
  | Extract<ThoughtStep, { kind: 'tool' }>;

export interface MessageSegments {
  /** Text / reasoning / tool segments in chronological (parts) order. */
  segments: MessageSegment[];
  /** Distinct NON-skill tool calls (by toolCallId) — same accounting as the
   *  timeline builder so the header summary is identical. */
  toolCount: number;
  /** Distinct skills touched (by `skillSlug`). */
  skillCount: number;
  /** True when at least one reasoning block has readable text. */
  hasReasoning: boolean;
  /** True while any reasoning is still streaming, any tool is mid-flight, or the
   *  trailing text run is still streaming. */
  isStreaming: boolean;
}

const EMPTY: MessageSegments = {
  segments: [],
  toolCount: 0,
  skillCount: 0,
  hasReasoning: false,
  isStreaming: false,
};

export function buildMessageSegments(
  parts: readonly unknown[] | undefined,
): MessageSegments {
  if (!Array.isArray(parts) || parts.length === 0) return EMPTY;

  const segments: MessageSegment[] = [];
  // toolCallId → index into `segments`, so a tool transitioning input→output
  // updates one segment in place (final state wins) instead of duplicating.
  const toolStepIndex = new Map<string, number>();
  const nonSkillToolCallIds = new Set<string>();
  const skillSlugs = new Set<string>();
  let hasReasoning = false;
  let reasoningSeq = 0;
  let textSeq = 0;

  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    const type = raw.type;

    if (type === 'text') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      const state: 'streaming' | 'done' =
        raw.state === 'streaming' ? 'streaming' : 'done';
      // Coalesce with an immediately-preceding text segment (defensive — the SDK
      // normally merges a contiguous text run into one part). The later state
      // wins so a run that finishes streaming reads as done.
      const prev = segments[segments.length - 1];
      if (prev && prev.kind === 'text') {
        prev.text += text;
        prev.state = state;
        continue;
      }
      segments.push({
        kind: 'text',
        id: `text-${textSeq++}`,
        text,
        state,
        isLast: false,
      });
      continue;
    }

    if (type === 'reasoning') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      const state: 'streaming' | 'done' =
        raw.state === 'streaming' ? 'streaming' : 'done';
      const trimmed = text.trim();
      const redacted = state === 'done' && trimmed === '';
      if (trimmed !== '') hasReasoning = true;
      segments.push({
        kind: 'reasoning',
        id: `reasoning-${reasoningSeq++}`,
        // Strip LEADING whitespace so a model that prefixes its reasoning with a
        // newline doesn't render an empty paragraph (stable across the stream).
        text: text.replace(/^\s+/, ''),
        state,
        redacted,
      });
      continue;
    }

    if (type.startsWith('tool-')) {
      const toolName = type.slice('tool-'.length);
      if (!toolName || toolName === 'invocation') continue;

      const state = toToolState(raw.state);
      const toolCallId =
        typeof raw.toolCallId === 'string' && raw.toolCallId
          ? raw.toolCallId
          : `tool-${segments.length}`;
      const input = isRecord(raw.input) ? raw.input : undefined;
      const output = 'output' in raw ? raw.output : undefined;
      const errorText =
        typeof raw.errorText === 'string' ? raw.errorText : undefined;

      const segment: Extract<ThoughtStep, { kind: 'tool' }> = {
        kind: 'tool',
        id: toolCallId,
        toolName,
        state,
        input,
        output,
        errorText,
      };

      if (SKILL_TOOL_NAMES.has(toolName)) {
        const slug =
          typeof input?.skillSlug === 'string' ? input.skillSlug : undefined;
        skillSlugs.add(slug ?? toolCallId);
      } else {
        nonSkillToolCallIds.add(toolCallId);
      }

      const existing = toolStepIndex.get(toolCallId);
      if (existing !== undefined) {
        segments[existing] = segment;
      } else {
        toolStepIndex.set(toolCallId, segments.length);
        segments.push(segment);
      }
      continue;
    }
    // file / source / step-start: not part of the rendered segment stream.
  }

  // Mark the final text run as `isLast` — it owns the live typewriter + markers.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.kind === 'text') {
      seg.isLast = true;
      break;
    }
  }

  // Derive isStreaming from the FINAL (deduped/coalesced) segments so a tool
  // that transitioned input→output, or a text run that finished, doesn't leave
  // the message stuck "streaming".
  const isStreaming = segments.some((s) => {
    if (s.kind === 'reasoning') return s.state === 'streaming';
    if (s.kind === 'tool') {
      return s.state === 'input-streaming' || s.state === 'input-available';
    }
    return s.state === 'streaming';
  });

  return {
    segments,
    toolCount: nonSkillToolCallIds.size,
    skillCount: skillSlugs.size,
    hasReasoning,
    isStreaming,
  };
}

/**
 * The live activity of a streaming turn, localized by `activityLabel`. Only the
 * gap-shell `ThinkingIndicator` constructs it now (phase-based "Routing"/
 * "Thinking"): the in-bubble header renders a STABLE "Thinking" and lets the
 * inline rows carry the tool/routing detail, so it no longer derives a label
 * from the trailing segment (which flipped confusingly as each step settled).
 * The `tool`/`responding` variants are retained for `activityLabel` coverage.
 */
export type ThoughtActivity =
  | { type: 'routing' }
  | { type: 'thinking' }
  | { type: 'tool'; toolName: string; input?: Record<string, unknown> }
  | { type: 'responding' };
