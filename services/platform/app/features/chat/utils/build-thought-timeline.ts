/**
 * Derives an ordered "thought process" timeline from a UIMessage's `parts`.
 *
 * The agent SDK appends parts chronologically (reasoning blocks, tool calls,
 * text), so we preserve array order — no re-sorting. Reasoning and tool parts
 * are surfaced; text/file/source/step-start parts are ignored (the answer text
 * renders separately). The same source works live (from the streaming
 * `activeMessage`) and for a persisted message after completion, so the
 * timeline can collapse into a summary that stays in history.
 *
 * Defensive by design: `parts` is typed loosely (`UIMessage['parts']`) and the
 * SDK's union is wide, so each entry is narrowed via property checks rather
 * than trusting the discriminant — mirrors `thinking-animation.tsx`.
 */

import { isRecord } from '@/lib/utils/type-guards';

export type ToolStepState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

export type ThoughtStep =
  | {
      kind: 'reasoning';
      id: string;
      text: string;
      state: 'streaming' | 'done';
      /** Anthropic redacted_thinking etc.: a done reasoning block with no
       *  readable text. Never render the raw blob — show a neutral note. */
      redacted: boolean;
    }
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      state: ToolStepState;
      input?: Record<string, unknown>;
      output?: unknown;
      errorText?: string;
    };

export interface ThoughtTimeline {
  steps: ThoughtStep[];
  /** Distinct NON-skill tool calls (by toolCallId). Skill-runtime tools
   *  (`expand_skill`/`read_skill_file`) are counted separately as skills so
   *  they aren't double-reported in the "used N tools" summary. */
  toolCount: number;
  /** Distinct skills touched, by `skillSlug` across the skill-runtime tools.
   *  Reading three files of one skill, or expanding then reading it, counts
   *  as a single skill. */
  skillCount: number;
  /** True when at least one reasoning block has readable text. */
  hasReasoning: boolean;
  /** True while any reasoning is still streaming or any tool is mid-flight. */
  isStreaming: boolean;
}

/** Skill-runtime tools surfaced in the parts stream. A skill "use" is a
 *  distinct `skillSlug` across these, not a raw tool-call count. */
const SKILL_TOOL_NAMES = new Set(['expand_skill', 'read_skill_file']);

const EMPTY: ThoughtTimeline = {
  steps: [],
  toolCount: 0,
  skillCount: 0,
  hasReasoning: false,
  isStreaming: false,
};

function toToolState(raw: unknown): ToolStepState {
  if (
    raw === 'input-streaming' ||
    raw === 'input-available' ||
    raw === 'output-available' ||
    raw === 'output-error'
  ) {
    return raw;
  }
  // Unknown/absent state: treat as still-providing-input so it reads as active
  // rather than silently "done".
  return 'input-available';
}

/**
 * Cheap O(1)-amortized predicate: does this message have ANY reasoning or tool
 * step? Equivalent to `buildThoughtTimeline(parts).steps.length > 0` but
 * early-exits on the first qualifying part and allocates nothing — used in the
 * per-token streaming render hot path (message list visibility + bubble gate)
 * where building the full timeline every render would be wasteful.
 */
export function hasThoughtSteps(
  parts: readonly unknown[] | undefined,
): boolean {
  if (!Array.isArray(parts)) return false;
  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    if (raw.type === 'reasoning') return true;
    if (raw.type.startsWith('tool-')) {
      const name = raw.type.slice('tool-'.length);
      if (name && name !== 'invocation') return true;
    }
  }
  return false;
}

/**
 * Cheap predicate: does this message have a tool part that is still mid-flight
 * (input-streaming / input-available)? Used to treat a pending tool-only turn
 * (observed before any reasoning/text streams) as active. Narrows each part the
 * same defensive way as the builder; allocates nothing and early-exits.
 */
export function hasInFlightTool(
  parts: readonly unknown[] | undefined,
): boolean {
  if (!Array.isArray(parts)) return false;
  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    if (!raw.type.startsWith('tool-')) continue;
    // Skip the generic `tool-invocation` placeholder, matching the builder and
    // `hasThoughtSteps` — only a concrete tool part counts as in-flight.
    const name = raw.type.slice('tool-'.length);
    if (!name || name === 'invocation') continue;
    if (raw.state === 'input-streaming' || raw.state === 'input-available') {
      return true;
    }
  }
  return false;
}

export function buildThoughtTimeline(
  parts: readonly unknown[] | undefined,
): ThoughtTimeline {
  if (!Array.isArray(parts) || parts.length === 0) return EMPTY;

  const steps: ThoughtStep[] = [];
  // toolCallId → index into `steps`, so a tool that transitions
  // input→output updates one step in place (final state wins) instead of
  // appearing twice.
  const toolStepIndex = new Map<string, number>();
  // Distinct non-skill tool calls (toolCount) and distinct skills (skillCount),
  // tracked apart so skill-runtime tools don't inflate the tool count.
  const nonSkillToolCallIds = new Set<string>();
  const skillSlugs = new Set<string>();
  let hasReasoning = false;
  let reasoningSeq = 0;

  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    const type = raw.type;

    if (type === 'reasoning') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      const state: 'streaming' | 'done' =
        raw.state === 'streaming' ? 'streaming' : 'done';
      const trimmed = text.trim();
      const redacted = state === 'done' && trimmed === '';
      if (trimmed !== '') hasReasoning = true;
      steps.push({
        kind: 'reasoning',
        id: `reasoning-${reasoningSeq++}`,
        text,
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
          : `tool-${steps.length}`;
      const input = isRecord(raw.input) ? raw.input : undefined;
      const output = 'output' in raw ? raw.output : undefined;
      const errorText =
        typeof raw.errorText === 'string' ? raw.errorText : undefined;

      const step: ThoughtStep = {
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
        // Count by distinct slug; fall back to the call id when the slug is
        // absent so a malformed call still registers as one skill.
        skillSlugs.add(slug ?? toolCallId);
      } else {
        nonSkillToolCallIds.add(toolCallId);
      }

      const existing = toolStepIndex.get(toolCallId);
      if (existing !== undefined) {
        // Same call observed twice in one parts array — keep position, take
        // the latest state/output.
        steps[existing] = step;
      } else {
        toolStepIndex.set(toolCallId, steps.length);
        steps.push(step);
      }
      continue;
    }
    // text / file / source / step-start: not part of the thought timeline.
  }

  // Derive isStreaming from the FINAL (deduped) steps so a tool that has since
  // transitioned input→output doesn't leave the timeline stuck "streaming".
  const isStreaming = steps.some((s) =>
    s.kind === 'reasoning'
      ? s.state === 'streaming'
      : s.state === 'input-streaming' || s.state === 'input-available',
  );

  return {
    steps,
    toolCount: nonSkillToolCallIds.size,
    skillCount: skillSlugs.size,
    hasReasoning,
    isStreaming,
  };
}
