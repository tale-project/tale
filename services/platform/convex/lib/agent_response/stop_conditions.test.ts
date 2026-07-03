import type { StepResult, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { hasValidToolCall } from './stop_conditions';

// Minimal step doubles — the condition only reads `toolCalls` off the last step.
function makeSteps(
  ...stepToolCalls: Array<Array<{ toolName: string; invalid?: boolean }>>
): Array<StepResult<ToolSet>> {
  const steps = stepToolCalls.map((toolCalls) => ({ toolCalls }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for AI SDK StepResult
  return steps as unknown as Array<StepResult<ToolSet>>;
}

const stop = hasValidToolCall('request_human_input');

describe('hasValidToolCall', () => {
  it('fires on a valid matching call in the last step', () => {
    const steps = makeSteps([{ toolName: 'request_human_input' }]);
    expect(stop({ steps })).toBe(true);
  });

  it('does NOT fire on a call marked invalid (input validation failed)', () => {
    // Regression: the SDK's `hasToolCall` matches toolName alone, so a call
    // whose input failed schema validation halted the loop even though no
    // approval card was created — stranding the turn with no card and no
    // chance for the model to fix its arguments.
    const steps = makeSteps([
      { toolName: 'request_human_input', invalid: true },
    ]);
    expect(stop({ steps })).toBe(false);
  });

  it('fires when a valid call sits next to an invalid one', () => {
    const steps = makeSteps([
      { toolName: 'request_human_input', invalid: true },
      { toolName: 'request_human_input' },
    ]);
    expect(stop({ steps })).toBe(true);
  });

  it('only inspects the LAST step', () => {
    const steps = makeSteps(
      [{ toolName: 'request_human_input' }],
      [{ toolName: 'web' }],
    );
    expect(stop({ steps })).toBe(false);
  });

  it('does not fire on other tools or empty steps', () => {
    expect(stop({ steps: makeSteps([{ toolName: 'web' }]) })).toBe(false);
    expect(stop({ steps: makeSteps() })).toBe(false);
  });
});
