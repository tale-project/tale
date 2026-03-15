/**
 * Test: Validate Variable References Known Sources
 *
 * Tests that variable references use recognized prefixes (steps, config, variables, etc.)
 * and detects mistyped or hallucinated references.
 */

import { describe, it, expect } from 'vitest';

import type { ParsedVariableReference } from './types';

import { validateVariableReferencesKnownSources } from './validate_variable_references_known_sources';

function makeRef(
  overrides: Partial<ParsedVariableReference> & { fullExpression: string },
): ParsedVariableReference {
  const expr = overrides.fullExpression;
  return {
    type: 'variable',
    path: expr.split('.'),
    originalTemplate: `{{${expr}}}`,
    ...overrides,
  };
}

describe('validateVariableReferencesKnownSources', () => {
  const knownStepSlugs = new Set([
    'get_customer',
    'send_email',
    'query_orders',
  ]);

  describe('should NOT error for valid references', () => {
    it('skips step-type references (already validated elsewhere)', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'steps.get_customer.output.data',
          type: 'step',
          stepSlug: 'get_customer',
          path: ['output', 'data'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });

    it('skips config-type references', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'config.backoffHours',
          type: 'config',
          path: ['backoffHours'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });

    it('skips variables-type references', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'variables.counter',
          type: 'variables',
          path: ['counter'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });

    it('skips input, secrets, loop, system types', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'input.name',
          type: 'input',
          path: ['name'],
        }),
        makeRef({
          fullExpression: 'secrets.apiKey',
          type: 'secret',
          path: ['apiKey'],
        }),
        makeRef({
          fullExpression: 'loop.item.email',
          type: 'loop',
          path: ['item', 'email'],
        }),
        makeRef({
          fullExpression: 'organizationId',
          type: 'system',
          path: ['organizationId'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });

    it('skips complex expressions', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'someExpr > 0 ? "yes" : "no"',
          type: 'variable',
          path: ['__complex_expression__'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('should error for singular "step." prefix', () => {
    it('detects step.xxx.output.data pattern', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'step.get_customer.output.data',
          path: ['step', 'get_customer', 'output', 'data'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('steps.');
      expect(result.errors[0]).toContain('singular');
    });

    it('detects step.xxx.response pattern', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'step.send_email.response',
          path: ['step', 'send_email', 'response'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('steps.');
    });
  });

  describe('should error when root matches a known step slug', () => {
    it('detects bare step slug with field access', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'get_customer.data',
          path: ['get_customer', 'data'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('steps.get_customer');
    });

    it('detects bare step slug with output path', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'send_email.output.data.response',
          path: ['send_email', 'output', 'data', 'response'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('steps.send_email');
    });

    it('detects bare step slug without any path', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'get_customer',
          path: ['get_customer'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('steps.get_customer');
    });
  });

  describe('should error for unknown/hallucinated variable references', () => {
    it('detects hallucinated step reference with dotted path', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'say_hello.response',
          path: ['say_hello', 'response'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('say_hello');
    });

    it('detects unknown single-segment variable', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'backoffHours',
          path: ['backoffHours'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('backoffHours');
    });

    it('detects unknown variable with step-output-like path', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'say_hello.output.data.message',
          path: ['say_hello', 'output', 'data', 'message'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('say_hello');
    });

    it('suggests config prefix for likely config variable', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'counter',
          path: ['counter'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/config\.|variables\./);
    });
  });

  describe('edge cases', () => {
    it('handles multiple errors in same step', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'say_hello.response',
          path: ['say_hello', 'response'],
        }),
        makeRef({ fullExpression: 'unknown_var', path: ['unknown_var'] }),
        makeRef({
          fullExpression: 'step.foo.output',
          path: ['step', 'foo', 'output'],
        }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(3);
    });

    it('returns no errors for empty refs array', () => {
      const result = validateVariableReferencesKnownSources(
        [],
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });

    it('returns no errors when all refs are non-variable types', () => {
      const refs: ParsedVariableReference[] = [
        makeRef({
          fullExpression: 'steps.foo.output.data',
          type: 'step',
          stepSlug: 'foo',
          path: ['output', 'data'],
        }),
        makeRef({
          fullExpression: 'input.name',
          type: 'input',
          path: ['name'],
        }),
        makeRef({ fullExpression: 'now', type: 'system', path: ['now'] }),
      ];
      const result = validateVariableReferencesKnownSources(
        refs,
        knownStepSlugs,
        'my_step',
      );
      expect(result.errors).toHaveLength(0);
    });
  });
});
