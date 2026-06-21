/**
 * Step modes — advisory projection hints distinct from the engine's `stepType`
 * (the mechanism: start/llm/condition/action/loop/output/sandbox). A mode tells
 * the operator UI how to frame a step ("what's happening"); the engine ignores
 * it. Maps onto existing waiting states rather than introducing runtime
 * behavior.
 */
export const STEP_MODES = [
  'automated', // no human in the loop
  'review_gate', // pauses for a human sign-off
  'human_input', // collects structured input from a human
  'terminal', // produces the final artifact / output
] as const;

type StepMode = (typeof STEP_MODES)[number];

const STEP_MODE_SET = new Set<string>(STEP_MODES);

export function isStepMode(value: string): value is StepMode {
  return STEP_MODE_SET.has(value);
}
