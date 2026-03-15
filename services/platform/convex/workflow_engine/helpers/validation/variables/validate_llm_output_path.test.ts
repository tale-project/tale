/**
 * Test: LLM Output Path Validation (isScalar)
 *
 * Tests that accessing sub-fields on LLM text output (which is a plain string)
 * produces validation errors, while LLM JSON output allows field access.
 */

import { describe, it, expect } from 'vitest';

import { validateWorkflowVariableReferences } from './validate';

function makeWorkflow(
  steps: Array<{
    stepSlug: string;
    stepType: string;
    config: Record<string, unknown>;
    nextSteps?: Record<string, string>;
  }>,
) {
  // Add a start step that chains to the first real step
  const startStep = {
    stepSlug: 'start',
    stepType: 'start',
    config: {},
    nextSteps: steps.length > 0 ? { default: steps[0].stepSlug } : {},
  };

  // Chain steps sequentially via nextSteps
  const allSteps = [startStep, ...steps];
  for (let i = 1; i < allSteps.length - 1; i++) {
    if (!allSteps[i].nextSteps) {
      allSteps[i].nextSteps = { default: allSteps[i + 1].stepSlug };
    }
  }

  return allSteps;
}

describe('LLM output path validation (isScalar)', () => {
  describe('LLM text output (default)', () => {
    it('allows accessing output.data directly', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'greet',
          stepType: 'llm',
          config: { prompt: 'Say hello' },
        },
        {
          stepSlug: 'use_greeting',
          stepType: 'output',
          config: {
            mapping: { result: '{{steps.greet.output.data}}' },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      const greetErrors = result.errors.filter((e) => e.includes('greet'));
      expect(greetErrors).toHaveLength(0);
    });

    it('errors when accessing sub-fields on text output', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'greet',
          stepType: 'llm',
          config: { prompt: 'Say hello' },
        },
        {
          stepSlug: 'use_greeting',
          stepType: 'output',
          config: {
            mapping: { result: '{{steps.greet.output.data.result}}' },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('plain string')]),
      );
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('steps.greet.output.data'),
        ]),
      );
    });

    it('errors when accessing deeply nested sub-fields on text output', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'analyze',
          stepType: 'llm',
          config: { prompt: 'Analyze this' },
        },
        {
          stepSlug: 'use_result',
          stepType: 'output',
          config: {
            mapping: {
              score: '{{steps.analyze.output.data.analysis.score}}',
            },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('analysis.score')]),
      );
    });

    it('treats LLM without outputFormat as text (default)', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'llm_step',
          stepType: 'llm',
          config: {},
        },
        {
          stepSlug: 'consumer',
          stepType: 'output',
          config: {
            mapping: { val: '{{steps.llm_step.output.data.field}}' },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('plain string')]),
      );
    });
  });

  describe('LLM JSON output', () => {
    it('allows accessing sub-fields on JSON output', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'analyze',
          stepType: 'llm',
          config: {
            prompt: 'Analyze this',
            outputFormat: 'json',
            outputSchema: { score: 'number', summary: 'string' },
          },
        },
        {
          stepSlug: 'use_result',
          stepType: 'output',
          config: {
            mapping: {
              score: '{{steps.analyze.output.data.score}}',
              summary: '{{steps.analyze.output.data.summary}}',
            },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      const analyzeErrors = result.errors.filter((e) => e.includes('analyze'));
      expect(analyzeErrors).toHaveLength(0);
    });

    it('allows accessing output.data directly on JSON output', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'analyze',
          stepType: 'llm',
          config: {
            prompt: 'Analyze this',
            outputFormat: 'json',
          },
        },
        {
          stepSlug: 'use_result',
          stepType: 'output',
          config: {
            mapping: { raw: '{{steps.analyze.output.data}}' },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      const analyzeErrors = result.errors.filter((e) => e.includes('analyze'));
      expect(analyzeErrors).toHaveLength(0);
    });
  });

  describe('LLM text output with outputFormat explicitly set', () => {
    it('errors on sub-field access when outputFormat is explicitly text', () => {
      const steps = makeWorkflow([
        {
          stepSlug: 'greet',
          stepType: 'llm',
          config: {
            prompt: 'Say hello',
            outputFormat: 'text',
          },
        },
        {
          stepSlug: 'use_greeting',
          stepType: 'output',
          config: {
            mapping: { result: '{{steps.greet.output.data.response}}' },
          },
        },
      ]);

      const result = validateWorkflowVariableReferences(steps);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('plain string')]),
      );
    });
  });
});
