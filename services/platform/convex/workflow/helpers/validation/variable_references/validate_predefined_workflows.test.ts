/**
 * Test: Validate Predefined Workflows
 *
 * This test validates all predefined workflows against the variable reference
 * validation logic to ensure that:
 * 1. All step references exist
 * 2. Steps only reference earlier steps (execution order)
 * 3. Output path access patterns are valid
 */

import { describe, it, expect } from 'vitest';
import { workflows } from '../../../../predefined_workflows';
import { validateWorkflowVariableReferences } from './validate_variable_references';

// Convert the workflows object to an array of entries for testing
const workflowEntries = Object.entries(workflows);

// Special step slugs that are valid terminations (not actual steps)
const SPECIAL_TERMINATION_STEPS = new Set(['noop', 'end', 'terminate', 'complete']);

describe('Predefined Workflows Variable Reference Validation', () => {
  // Test each workflow individually
  describe.each(workflowEntries)(
    'workflow: %s',
    (workflowKey, workflowDefinition) => {
      it('should have valid variable references', () => {
        const { stepsConfig } = workflowDefinition;

        // Validate variable references
        const result = validateWorkflowVariableReferences(stepsConfig);

        // Log any errors or warnings for debugging
        if (result.errors.length > 0) {
          console.error(`[${workflowKey}] Errors:`, result.errors);
        }
        if (result.warnings.length > 0) {
          console.warn(`[${workflowKey}] Warnings:`, result.warnings);
        }

        // Assert no errors (result.valid is the correct property)
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      });

      it('should have all referenced steps existing', () => {
        const { stepsConfig } = workflowDefinition;
        const stepSlugs = new Set(stepsConfig.map((s: { stepSlug: string }) => s.stepSlug));

        // Check that all nextSteps references exist
        for (const step of stepsConfig) {
          const typedStep = step as { stepSlug: string; nextSteps?: Record<string, string> };
          if (typedStep.nextSteps) {
            for (const [outcome, targetSlug] of Object.entries(typedStep.nextSteps)) {
              // Skip empty, special termination steps
              if (!targetSlug || SPECIAL_TERMINATION_STEPS.has(targetSlug)) {
                continue;
              }
              expect(
                stepSlugs.has(targetSlug),
                `Step "${typedStep.stepSlug}" references non-existent step "${targetSlug}" in nextSteps.${outcome}`,
              ).toBe(true);
            }
          }
        }
      });
    },
  );

  // Summary test
  it('should validate all predefined workflows without errors', () => {
    const allResults: Array<{
      key: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
    }> = [];

    for (const [key, workflow] of workflowEntries) {
      const result = validateWorkflowVariableReferences(workflow.stepsConfig);
      allResults.push({
        key,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    // Log summary
    console.log('\n=== Predefined Workflows Validation Summary ===');
    console.log(`Total workflows: ${allResults.length}`);
    console.log(`Valid: ${allResults.filter((r) => r.valid).length}`);
    console.log(`Invalid: ${allResults.filter((r) => !r.valid).length}`);

    const invalidWorkflows = allResults.filter((r) => !r.valid);
    if (invalidWorkflows.length > 0) {
      console.log('\nInvalid workflows:');
      for (const wf of invalidWorkflows) {
        console.log(`  - ${wf.key}: ${wf.errors.join(', ')}`);
      }
    }

    const workflowsWithWarnings = allResults.filter((r) => r.warnings.length > 0);
    if (workflowsWithWarnings.length > 0) {
      console.log('\nWorkflows with warnings:');
      for (const wf of workflowsWithWarnings) {
        console.log(`  - ${wf.key}: ${wf.warnings.join(', ')}`);
      }
    }

    // All workflows should be valid
    expect(invalidWorkflows).toEqual([]);
  });
});

