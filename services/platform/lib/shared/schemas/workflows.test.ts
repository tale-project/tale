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
            labelKey: 'pack.review',
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

  describe('step — i18n (self-translation)', () => {
    it('parses per-locale name/description overrides on a step and keeps the block optional', () => {
      const result = workflowJsonSchema.safeParse({
        name: 'Annotated',
        steps: [
          {
            stepSlug: 'review',
            name: 'Review',
            stepType: 'action',
            i18n: {
              de: { name: 'Prüfen', description: 'DE Beschreibung' },
              fr: { name: 'Examiner' },
            },
          },
          {
            stepSlug: 'done',
            name: 'Done',
            stepType: 'output',
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.steps[0]?.i18n?.de?.name).toBe('Prüfen');
        expect(result.data.steps[0]?.i18n?.de?.description).toBe(
          'DE Beschreibung',
        );
        expect(result.data.steps[0]?.i18n?.fr?.name).toBe('Examiner');
        expect(result.data.steps[1]?.i18n).toBeUndefined();
      }
    });

    it('rejects a malformed locale tag on a step i18n block', () => {
      const result = workflowJsonSchema.safeParse({
        name: 'Bad locale',
        steps: [
          {
            stepSlug: 'review',
            name: 'Review',
            stepType: 'action',
            i18n: { DE: { name: 'x' } },
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('round-trips a step i18n block through JSON', () => {
      const input = {
        name: 'Round trip',
        steps: [
          {
            stepSlug: 'review',
            name: 'Review',
            stepType: 'action',
            i18n: { de: { name: 'Prüfen' }, fr: { name: 'Examiner' } },
          },
        ],
      };
      const result = workflowJsonSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        const reparsed = workflowJsonSchema.safeParse(
          JSON.parse(JSON.stringify(result.data)),
        );
        expect(reparsed.success).toBe(true);
        if (reparsed.success) {
          expect(reparsed.data.steps[0]?.i18n).toEqual(
            result.data.steps[0]?.i18n,
          );
        }
      }
    });
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

  describe('specification', () => {
    it('omits specification and specificationMeta when absent', () => {
      const result = workflowJsonSchema.safeParse({ name: 'No spec' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specification).toBeUndefined();
        expect(result.data.specificationMeta).toBeUndefined();
      }
    });

    it('parses and round-trips a specification with sync metadata', () => {
      const input = {
        name: 'Specced',
        specification: 'Start, then greet the customer, then finish.',
        specificationMeta: {
          sourceHash: 'abc123',
          generatedAt: 1_700_000_000_000,
          direction: 'graph_to_spec',
          model: 'gpt-test',
        },
      };
      const result = workflowJsonSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specification).toBe(input.specification);
        expect(result.data.specificationMeta).toEqual(input.specificationMeta);
        const reparsed = workflowJsonSchema.safeParse(
          JSON.parse(JSON.stringify(result.data)),
        );
        expect(reparsed.success).toBe(true);
      }
    });

    it('accepts a specification with no sync metadata (hand-written, never synced)', () => {
      const result = workflowJsonSchema.safeParse({
        name: 'Hand-written spec',
        specification: 'A workflow that does things.',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specification).toBe('A workflow that does things.');
        expect(result.data.specificationMeta).toBeUndefined();
      }
    });

    it('rejects an invalid sync direction', () => {
      const result = workflowJsonSchema.safeParse({
        name: 'Bad direction',
        specification: 'x',
        specificationMeta: {
          sourceHash: 'abc123',
          generatedAt: 1_700_000_000_000,
          direction: 'sideways',
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a specification longer than 20,000 characters', () => {
      const result = workflowJsonSchema.safeParse({
        name: 'Too long',
        specification: 'x'.repeat(20_001),
      });
      expect(result.success).toBe(false);
    });
  });
});
