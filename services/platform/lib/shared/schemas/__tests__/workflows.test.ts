import { describe, it, expect } from 'vitest';

import { workflowJsonSchema } from '../workflows';

describe('workflowJsonSchema', () => {
  it('parses a config without a steps key, defaulting steps to []', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'Blank',
      description: '',
      installed: true,
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
    }
  });

  it('parses a config with explicit empty steps', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'Blank',
      installed: true,
      enabled: false,
      steps: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
    }
  });

  it('parses a config with one step', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'One step',
      installed: true,
      enabled: false,
      steps: [
        {
          stepSlug: 'start',
          name: 'Start',
          stepType: 'start',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toHaveLength(1);
      expect(result.data.steps[0]?.config).toEqual({});
      expect(result.data.steps[0]?.nextSteps).toEqual({});
    }
  });
});
