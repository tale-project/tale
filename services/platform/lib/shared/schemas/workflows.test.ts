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

  it('parses and round-trips a step with ui + role annotations', () => {
    const input = {
      name: 'Annotated',
      steps: [
        {
          stepSlug: 'review',
          name: 'Review',
          stepType: 'action',
          role: 'reviewer',
          ui: {
            stage: 'review',
            render: 'review',
            labelKey: 'pack.issueDesk.review',
            params: { mode: 'gate', cardinality: 'one' },
          },
        },
      ],
    };
    const result = workflowJsonSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const step = result.data.steps[0];
      expect(step?.role).toBe('reviewer');
      expect(step?.ui?.render).toBe('review');
      expect(step?.ui?.params?.mode).toBe('gate');
      // round-trip: re-parsing the serialized output is stable
      const reparsed = workflowJsonSchema.safeParse(
        JSON.parse(JSON.stringify(result.data)),
      );
      expect(reparsed.success).toBe(true);
    }
  });

  it('keeps an unknown render value parseable (known-ness is a validator concern)', () => {
    // The file schema is lenient so files never become unloadable as the
    // vocabulary evolves; validateWorkflowDefinition flags unknown kinds.
    const result = workflowJsonSchema.safeParse({
      name: 'Lenient',
      steps: [
        {
          stepSlug: 's',
          name: 'S',
          stepType: 'action',
          ui: { render: 'not_a_real_kind' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
