import { describe, it, expect } from 'vitest';

import { stripTransientVariables } from './strip_transient_variables';

describe('stripTransientVariables', () => {
  it('should remove lastOutput and steps from variables', () => {
    const vars = {
      organizationId: 'org_1',
      lastOutput: { huge: 'data'.repeat(1000) },
      steps: { step_1: { output: 'big' }, step_2: { output: 'bigger' } },
      userEmail: 'test@example.com',
    };

    const result = stripTransientVariables(vars);

    expect(result).toEqual({
      organizationId: 'org_1',
      userEmail: 'test@example.com',
    });
    expect(result).not.toHaveProperty('lastOutput');
    expect(result).not.toHaveProperty('steps');
  });

  it('should return empty object when all keys are transient', () => {
    const vars = {
      lastOutput: 'something',
      steps: {},
    };

    const result = stripTransientVariables(vars);

    expect(result).toEqual({});
  });

  it('should return all keys when no transient keys exist', () => {
    const vars = {
      organizationId: 'org_1',
      customVar: 'value',
      anotherVar: 42,
    };

    const result = stripTransientVariables(vars);

    expect(result).toEqual(vars);
  });

  it('should handle empty object', () => {
    const result = stripTransientVariables({});
    expect(result).toEqual({});
  });

  it('should preserve nested objects that are not transient', () => {
    const vars = {
      lastOutput: { will: 'be removed' },
      config: { nested: { deep: true } },
      steps: { also: 'removed' },
    };

    const result = stripTransientVariables(vars);

    expect(result).toEqual({
      config: { nested: { deep: true } },
    });
  });
});
