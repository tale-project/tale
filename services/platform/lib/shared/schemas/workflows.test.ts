import { describe, it, expect } from 'vitest';

import { workflowJsonSchema } from './workflows';

describe('workflowJsonSchema', () => {
  it('parses a config without a steps key, defaulting steps to []', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'Blank',
      description: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
    }
  });

  it('parses a config with explicit empty steps', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'Blank',
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

  it('parses a config with requires.integrations', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'Drive Sync',
      requires: {
        integrations: [
          { name: 'google_drive', operations: ['list_files', 'download_file'] },
        ],
      },
      steps: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requires?.integrations).toHaveLength(1);
      expect(result.data.requires?.integrations[0]?.name).toBe('google_drive');
      expect(result.data.requires?.integrations[0]?.operations).toEqual([
        'list_files',
        'download_file',
      ]);
    }
  });

  it('omits requires when not declared', () => {
    const result = workflowJsonSchema.safeParse({
      name: 'No deps',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requires).toBeUndefined();
    }
  });
});
