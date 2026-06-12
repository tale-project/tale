/**
 * Shared types for an assistant turn's "thought process" — the reasoning blocks
 * and tool calls derived from a UIMessage's `parts`.
 *
 * Kept in their own module (no logic, no JSX) so both the part-walker
 * ({@link ./build-message-segments}) and the timeline renderers
 * (`components/thought-timeline/`) can import them without pulling in the other.
 */

/** Lifecycle of a tool part, mirroring the agent SDK's tool-call states. */
export type ToolStepState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

/** One reasoning block or tool call surfaced in the thought timeline. */
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

/** Skill-runtime tools surfaced in the parts stream. A skill "use" is a
 *  distinct `skillSlug` across these, not a raw tool-call count — so they're
 *  counted as skills, not tools, in the timeline summary. */
export const SKILL_TOOL_NAMES = new Set(['expand_skill', 'read_skill_file']);

/** Narrow a raw `state` value to a {@link ToolStepState}. Unknown/absent reads
 *  as still-providing-input so it shows as active rather than silently "done". */
export function toToolState(raw: unknown): ToolStepState {
  if (
    raw === 'input-streaming' ||
    raw === 'input-available' ||
    raw === 'output-available' ||
    raw === 'output-error'
  ) {
    return raw;
  }
  return 'input-available';
}
