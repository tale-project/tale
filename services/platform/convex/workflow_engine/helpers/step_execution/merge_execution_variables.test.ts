import { describe, it, expect } from 'vitest';

import { mergeExecutionVariables } from './merge_execution_variables';

describe('mergeExecutionVariables', () => {
  it('should merge base variables with steps', () => {
    const base = { foo: 'bar', count: 1 };
    const steps = { step_a: { output: { data: 'hello' } } };

    const result = mergeExecutionVariables(base, steps);

    expect(result).toEqual({
      foo: 'bar',
      count: 1,
      steps: { step_a: { output: { data: 'hello' } } },
    });
  });

  it('should include loop variables when provided', () => {
    const base = { foo: 'bar' };
    const steps = {};
    const loopVars = { item: 'x', index: 0 };

    const result = mergeExecutionVariables(base, steps, loopVars);

    expect(result).toEqual({
      foo: 'bar',
      steps: {},
      loop: { item: 'x', index: 0 },
    });
  });

  it('should not include loop key when loopVariables is undefined', () => {
    const result = mergeExecutionVariables({ a: 1 }, {});

    expect(result).toEqual({ a: 1, steps: {} });
    expect('loop' in result).toBe(false);
  });

  it('should handle empty base variables', () => {
    const result = mergeExecutionVariables({}, { step_1: 'done' });

    expect(result).toEqual({ steps: { step_1: 'done' } });
  });

  it('should overwrite a base key named "steps"', () => {
    const base = { steps: 'old_value', other: true };
    const steps = { step_a: {} };

    const result = mergeExecutionVariables(base, steps);

    expect(result.steps).toEqual({ step_a: {} });
    expect(result.other).toBe(true);
  });

  it('should preserve nested objects in base variables', () => {
    const base = { config: { nested: { deep: true } } };
    const steps = {};

    const result = mergeExecutionVariables(base, steps);

    expect(result.config).toEqual({ nested: { deep: true } });
  });
});
