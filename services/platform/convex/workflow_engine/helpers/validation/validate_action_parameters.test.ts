/**
 * Test: Action Parameters Validation
 *
 * Tests parameter validation against action registry validators.
 * Focuses on patterns the AI agent commonly generates that cause
 * validation failures and retry loops.
 */

import { describe, it, expect } from 'vitest';

import { validateActionParameters } from './validate_action_parameters';

describe('validateActionParameters', () => {
  describe('set_variables action', () => {
    it('should pass with valid parameters', () => {
      const result = validateActionParameters('set_variables', {
        variables: [{ name: 'counter', value: 0 }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when variables is missing', () => {
      const result = validateActionParameters('set_variables', {});

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('variables'))).toBe(true);
    });

    it('should fail when parameters is undefined', () => {
      const result = validateActionParameters('set_variables', undefined);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('requires parameters'))).toBe(
        true,
      );
    });

    it('should fail with unknown fields alongside variables', () => {
      // AI agent puts nextSteps or other fields at the parameters level
      const result = validateActionParameters('set_variables', {
        variables: [{ name: 'counter', value: 0 }],
        nextSteps: { success: 'next' },
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Unknown field') && e.includes('nextSteps'),
        ),
      ).toBe(true);
    });
  });

  describe('conversation action (discriminated union)', () => {
    it('should pass with valid create operation', () => {
      const result = validateActionParameters('conversation', {
        operation: 'create',
        subject: 'Test conversation',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail with missing operation', () => {
      const result = validateActionParameters('conversation', {
        subject: 'Test conversation',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('operation'))).toBe(true);
    });

    it('should fail with invalid operation', () => {
      const result = validateActionParameters('conversation', {
        operation: 'invalid_op',
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Invalid operation') && e.includes('invalid_op'),
        ),
      ).toBe(true);
    });

    it('should fail with nextSteps polluting parameters', () => {
      // When nextSteps leaks into config without parameters wrapper,
      // it becomes part of the parameters and fails validation
      const result = validateActionParameters('conversation', {
        operation: 'create',
        subject: 'Test',
        nextSteps: { success: 'send_email' },
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Unknown field') && e.includes('nextSteps'),
        ),
      ).toBe(true);
    });

    it('should fail with fields from wrong operation variant', () => {
      // AI generates create operation but includes fields from update operation
      const result = validateActionParameters('conversation', {
        operation: 'create',
        conversationId: 'some-id',
        updates: { status: 'closed' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unknown field'))).toBe(true);
    });
  });

  describe('customer action', () => {
    it('should pass with valid query operation', () => {
      const result = validateActionParameters('customer', {
        operation: 'query',
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when query operation is missing required paginationOpts', () => {
      // AI agent commonly forgets required fields for an operation
      const result = validateActionParameters('customer', {
        operation: 'query',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('paginationOpts'))).toBe(
        true,
      );
    });
  });

  describe('unknown action type', () => {
    it('should fail for non-existent action type', () => {
      const result = validateActionParameters('nonexistent_action', {
        foo: 'bar',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unknown action type'))).toBe(
        true,
      );
    });
  });

  describe('nextSteps contamination at parameter level', () => {
    it('should reject nextSteps as unknown field in raw parameters', () => {
      // validateActionParameters correctly rejects unknown fields
      const result = validateActionParameters('set_variables', {
        variables: [{ name: 'counter', value: 0 }],
        nextSteps: { success: 'next_step' },
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Unknown field') && e.includes('nextSteps'),
        ),
      ).toBe(true);
    });

    it('should pass when nextSteps is NOT in the parameters', () => {
      const result = validateActionParameters('set_variables', {
        variables: [{ name: 'counter', value: 0 }],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
