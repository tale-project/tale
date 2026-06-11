import { describe, expect, it } from 'vitest';

import {
  buildVariablesInspection,
  INSPECTION_OUTPUT_MAX_CHARS,
} from './build_variables_inspection';

describe('buildVariablesInspection', () => {
  it('shapes steps, variables, lastOutput and input', () => {
    const result = buildVariablesInspection(
      {
        steps: {
          fetch: { stepType: 'action', name: 'Fetch', output: { rows: 3 } },
        },
        variables: { customerId: 'c-1' },
        lastOutput: { rows: 3 },
        organizationId: 'org-1',
      },
      { source: 'test' },
    );

    expect(result).toEqual({
      input: { source: 'test' },
      variables: { customerId: 'c-1' },
      steps: {
        fetch: { stepType: 'action', name: 'Fetch', output: { rows: 3 } },
      },
      lastOutput: { rows: 3 },
    });
  });

  it('handles empty variables', () => {
    const result = buildVariablesInspection({}, undefined);

    expect(result.steps).toEqual({});
    expect(result.variables).toEqual({});
    expect(result.lastOutput).toBeUndefined();
    expect(result.lastOutputTruncated).toBeUndefined();
  });

  it('truncates oversized step outputs and flags them', () => {
    const big = 'x'.repeat(INSPECTION_OUTPUT_MAX_CHARS + 100);
    const result = buildVariablesInspection(
      {
        steps: {
          llm: { stepType: 'llm', name: 'Generate', output: big },
          small: { stepType: 'action', name: 'Small', output: 'ok' },
        },
      },
      undefined,
    );

    expect(result.steps.llm.outputTruncated).toBe(true);
    expect(typeof result.steps.llm.output).toBe('string');
    expect(String(result.steps.llm.output)).toHaveLength(
      INSPECTION_OUTPUT_MAX_CHARS,
    );
    expect(result.steps.small).toEqual({
      stepType: 'action',
      name: 'Small',
      output: 'ok',
    });
  });

  it('truncates an oversized lastOutput', () => {
    const big = { text: 'y'.repeat(INSPECTION_OUTPUT_MAX_CHARS + 100) };
    const result = buildVariablesInspection({ lastOutput: big }, undefined);

    expect(result.lastOutputTruncated).toBe(true);
    expect(typeof result.lastOutput).toBe('string');
  });

  it('ignores non-record step entries', () => {
    const result = buildVariablesInspection(
      { steps: { broken: 'not-a-record', ok: { output: 1 } } },
      undefined,
    );

    expect(Object.keys(result.steps)).toEqual(['ok']);
  });
});
