import { describe, expect, it } from 'vitest';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';

import { computeWorkflowSpecificationValidation } from './use-workflow-specification-validation';

/** Minimal valid workflow — the baseline each case perturbs. */
function baseConfig(
  overrides: Partial<WorkflowJsonConfig> = {},
): WorkflowJsonConfig {
  return {
    steps: [],
    specification: 'Start, then greet the customer, then finish.',
    ...overrides,
  };
}

describe('computeWorkflowSpecificationValidation', () => {
  it('accepts a workflow with no specification', () => {
    const result = computeWorkflowSpecificationValidation(
      baseConfig({ specification: undefined }),
    );
    expect(result.isValid).toBe(true);
    expect(result.invalidFields.size).toBe(0);
  });

  it('accepts a specification at the 20,000-character ceiling', () => {
    const result = computeWorkflowSpecificationValidation(
      baseConfig({ specification: 'x'.repeat(20_000) }),
    );
    expect(result.isValid).toBe(true);
  });

  it('flags a specification over the 20,000-character ceiling (#2665)', () => {
    const result = computeWorkflowSpecificationValidation(
      baseConfig({ specification: 'x'.repeat(20_001) }),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidFields.has('specification')).toBe(true);
  });
});
