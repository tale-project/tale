/**
 * Test: Step Config Validation
 *
 * Tests the step configuration validation, focusing on patterns
 * that the AI workflow agent commonly generates — particularly
 * partial updates and misplaced fields.
 */

import { describe, it, expect } from 'vitest';

import { validateStepConfig } from './validate_step_config';

describe('validateStepConfig', () => {
  describe('valid complete step definitions', () => {
    it('should pass for a valid action step with parameters wrapper', () => {
      const result = validateStepConfig({
        stepSlug: 'set_vars',
        name: 'Set Variables',
        stepType: 'action',
        config: {
          type: 'set_variables',
          parameters: {
            variables: [{ name: 'foo', value: 'bar' }],
          },
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for a valid action step without parameters wrapper (legacy format)', () => {
      const result = validateStepConfig({
        stepSlug: 'set_vars',
        name: 'Set Variables',
        stepType: 'action',
        config: {
          type: 'set_variables',
          variables: [{ name: 'foo', value: 'bar' }],
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for a valid start step', () => {
      const result = validateStepConfig({
        stepSlug: 'trigger',
        name: 'Start',
        stepType: 'start',
        config: {},
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for a valid llm step', () => {
      const result = validateStepConfig({
        stepSlug: 'analyze',
        name: 'Analyze Data',
        stepType: 'llm',
        config: {
          name: 'analyzer',
          systemPrompt: 'You are a data analyst.',
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('AI agent common mistakes', () => {
    it('should warn but not fail when nextSteps is placed inside config for action step', () => {
      // AI agents frequently put nextSteps inside config instead of at the top level.
      // After fix: nextSteps is stripped from parameters and a warning is emitted,
      // so validation no longer fails just because of misplaced nextSteps.
      const result = validateStepConfig({
        stepSlug: 'find_customers',
        name: 'Find Customers',
        stepType: 'action',
        config: {
          type: 'customer',
          operation: 'query',
          paginationOpts: { numItems: 10, cursor: null },
          nextSteps: { success: 'next_step' },
        },
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('nextSteps'))).toBe(true);
    });

    it('should fail when action step has no type field in config', () => {
      const result = validateStepConfig({
        stepSlug: 'do_something',
        name: 'Do Something',
        stepType: 'action',
        config: {
          operation: 'query',
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('type'))).toBe(true);
    });

    it('should fail when using action type name as stepType', () => {
      // AI agents sometimes use "customer" or "conversation" as stepType
      // instead of "action" with config.type = "customer"
      const result = validateStepConfig({
        stepSlug: 'find_customers',
        name: 'Find Customers',
        stepType: 'customer',
        config: {
          operation: 'query',
        },
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('Invalid step type') && e.includes('customer'),
        ),
      ).toBe(true);
    });

    it('should fail when conversation action has unknown fields (flat config)', () => {
      // AI generates flat config with fields that aren't valid for the operation.
      // Without parameters wrapper, all config fields (minus type) are treated as parameters.
      const result = validateStepConfig({
        stepSlug: 'create_conversation',
        name: 'Create Conversation',
        stepType: 'action',
        config: {
          type: 'conversation',
          operation: 'create',
          customerId: '{{steps.find_customer.result.id}}',
          subject: 'Follow up',
          // These are unknown fields for conversation create
          emailBody: 'Hello',
          recipientEmail: 'test@test.com',
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unknown field'))).toBe(true);
    });
  });

  describe('partial updates (update_workflow_step scenarios)', () => {
    it('should fail when stepType is undefined but config is provided', () => {
      // This is the critical bug: update_workflow_step passes stepType: undefined
      // when only config is being updated, causing "Step type is required" error.
      // The AI agent then retries 30 times with the same payload.
      const result = validateStepConfig({
        stepSlug: 'update',
        name: 'Step',
        stepType: undefined,
        config: {
          type: 'set_variables',
          parameters: {
            variables: [{ name: 'foo', value: 'bar' }],
          },
        },
      });

      // Current behavior: fails with "Step type is required"
      // This documents the bug - a partial update with valid config shouldn't fail
      // just because stepType wasn't re-sent in the update payload
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('Step type is required')),
      ).toBe(true);
    });

    it('should fail when stepType is undefined even with valid llm config', () => {
      const result = validateStepConfig({
        stepSlug: 'update',
        name: 'Analyze',
        stepType: undefined,
        config: {
          name: 'analyzer',
          systemPrompt: 'Analyze the data.',
        },
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('Step type is required')),
      ).toBe(true);
    });
  });

  describe('slug validation', () => {
    it('should pass for valid snake_case slug', () => {
      const result = validateStepConfig({
        stepSlug: 'find_inactive_customers',
        name: 'Find',
        stepType: 'start',
        config: {},
      });

      expect(result.valid).toBe(true);
    });

    it('should fail for camelCase slug', () => {
      const result = validateStepConfig({
        stepSlug: 'findCustomers',
        name: 'Find',
        stepType: 'start',
        config: {},
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('snake_case'))).toBe(true);
    });

    it('should fail for missing slug', () => {
      const result = validateStepConfig({
        stepSlug: undefined,
        name: 'Find',
        stepType: 'start',
        config: {},
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('slug is required'))).toBe(
        true,
      );
    });
  });
});
