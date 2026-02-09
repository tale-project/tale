/**
 * Test: Validate Predefined Workflows
 *
 * This test validates all predefined workflows against the complete validation
 * logic to ensure that:
 * 1. Workflow structure is valid (name, steps)
 * 2. All step configs are valid (stepSlug, name, stepType, config)
 * 3. All nextSteps references exist
 * 4. All variable references are valid (step existence, execution order, path structure)
 * 5. Action parameters are valid against their registered validators
 */

import { describe, it, expect } from 'vitest';

import { workflows } from '../../../predefined_workflows';
import { validateWorkflowDefinition } from './validate_workflow_definition';

// Convert the workflows object to an array of entries for testing
const workflowEntries = Object.entries(workflows);

// Special step slugs that are valid terminations (not actual steps)
const SPECIAL_TERMINATION_STEPS = new Set([
  'noop',
  'end',
  'terminate',
  'complete',
]);

describe('Predefined Workflows Validation', () => {
  // Test each workflow individually
  describe.each(workflowEntries)(
    'workflow: %s',
    (workflowKey, workflowDefinition) => {
      it('should have valid workflow definition', () => {
        const { stepsConfig } = workflowDefinition;

        // Validate entire workflow definition
        // Use workflowConfig.name for more accurate validation, falling back to workflowKey
        const result = validateWorkflowDefinition(
          { name: workflowDefinition.workflowConfig?.name ?? workflowKey },
          stepsConfig,
        );

        // Log any errors or warnings for debugging
        if (result.errors.length > 0) {
          console.error(`[${workflowKey}] Errors:`, result.errors);
        }
        if (result.warnings.length > 0) {
          console.warn(`[${workflowKey}] Warnings:`, result.warnings);
        }

        // Assert no errors
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      });

      it('should have all referenced steps existing', () => {
        const { stepsConfig } = workflowDefinition;
        const stepSlugs = new Set(
          stepsConfig.map((s: { stepSlug: string }) => s.stepSlug),
        );

        // Check that all nextSteps references exist
        for (const step of stepsConfig) {
          const typedStep = step as {
            stepSlug: string;
            nextSteps?: Record<string, string>;
          };
          if (typedStep.nextSteps) {
            for (const [outcome, targetSlug] of Object.entries(
              typedStep.nextSteps,
            )) {
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
      const result = validateWorkflowDefinition(
        { name: key },
        workflow.stepsConfig,
      );
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

    const workflowsWithWarnings = allResults.filter(
      (r) => r.warnings.length > 0,
    );
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
