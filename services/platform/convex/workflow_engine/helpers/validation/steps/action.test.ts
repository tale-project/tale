/**
 * Test: Action Step Validator
 *
 * Tests the action step validator (steps/action.ts) which is the layer
 * between validateStepConfig and validateActionParameters.
 * Focuses on the nextSteps stripping fix and parameter extraction.
 */

import { describe, it, expect } from 'vitest';

import { validateActionStep } from './action';

describe('validateActionStep', () => {
  describe('valid configurations', () => {
    it('should pass with parameters wrapper', () => {
      const result = validateActionStep({
        type: 'set_variables',
        parameters: {
          variables: [{ name: 'counter', value: 0 }],
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass with flat config (legacy format)', () => {
      const result = validateActionStep({
        type: 'set_variables',
        variables: [{ name: 'counter', value: 0 }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass with conversation create operation', () => {
      const result = validateActionStep({
        type: 'conversation',
        operation: 'create',
        subject: 'Test conversation',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('nextSteps misplacement (fix verification)', () => {
    it('should pass when nextSteps is in flat config — stripped before parameter validation', () => {
      // Before fix: nextSteps leaked into parameters via rest spread, causing
      // "Unknown field nextSteps" error and infinite retry loops.
      // After fix: nextSteps is stripped from the rest spread and a warning is emitted.
      const result = validateActionStep({
        type: 'set_variables',
        variables: [{ name: 'counter', value: 0 }],
        nextSteps: { success: 'next_step' },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('nextSteps'))).toBe(true);
    });

    it('should pass when nextSteps is in flat conversation config', () => {
      const result = validateActionStep({
        type: 'conversation',
        operation: 'create',
        subject: 'Test',
        nextSteps: { success: 'send_email', failure: 'log_error' },
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('nextSteps'))).toBe(true);
    });

    it('should not strip nextSteps from parameters wrapper', () => {
      // When parameters wrapper is used, nextSteps inside it is genuinely wrong
      // and should be caught by parameter validation
      const result = validateActionStep({
        type: 'set_variables',
        parameters: {
          variables: [{ name: 'counter', value: 0 }],
          nextSteps: { success: 'next' },
        },
      });

      // nextSteps inside parameters is still invalid
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Unknown field') && e.includes('nextSteps'),
        ),
      ).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('should fail when type is missing', () => {
      const result = validateActionStep({
        operation: 'query',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('should fail when type is not a string', () => {
      const result = validateActionStep({
        type: 123,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });
  });
});
