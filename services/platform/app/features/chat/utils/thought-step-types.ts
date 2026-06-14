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

/** One sub-agent tool call, folded under its parent Task tool card. Mirrors the
 *  persisted `SubAgentStepData` (services/.../agent_message_parts.ts) — both the
 *  live and persisted paths put this shape on the Task step's `output.steps`. */
export interface SubAgentStep {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

/** Pull the folded sub-agent steps off a tool step's `output`, if present. Both
 *  the live builder and the persisted path (after toUIMessages unwraps the json
 *  tool-result) leave `{ report, steps }` on `output`. Returns the steps array
 *  only when it's a non-empty list, so callers can branch on truthiness. */
export function subAgentSteps(
  step: Extract<ThoughtStep, { kind: 'tool' }>,
): SubAgentStep[] | undefined {
  const out = step.output;
  if (out === null || typeof out !== 'object') return undefined;
  const steps = (out as { steps?: SubAgentStep[] }).steps;
  return Array.isArray(steps) && steps.length > 0 ? steps : undefined;
}

/** The sub-agent's final report (markdown) folded onto a Task step's `output`. */
export function subAgentReport(
  step: Extract<ThoughtStep, { kind: 'tool' }>,
): string | undefined {
  const out = step.output;
  if (out === null || typeof out !== 'object') return undefined;
  const report = (out as { report?: unknown }).report;
  return typeof report === 'string' && report.trim() !== ''
    ? report
    : undefined;
}

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
