/**
 * Test: Circular Dependency Validator
 *
 * Tests the circular dependency detection in workflow step connections.
 */

import { describe, it, expect } from 'vitest';

import { validateCircularDependencies } from './circular_dependency_validator';

type TestStep = {
  stepSlug: string;
  stepType?: string;
  nextSteps?: Record<string, string>;
};

describe('Circular Dependency Validator', () => {
  describe('valid workflows (no cycles)', () => {
    it('should pass for linear workflow', () => {
      const steps: TestStep[] = [
        { stepSlug: 'trigger', nextSteps: { success: 'step_a' } },
        { stepSlug: 'step_a', nextSteps: { success: 'step_b' } },
        { stepSlug: 'step_b', nextSteps: { success: 'step_c' } },
        { stepSlug: 'step_c', nextSteps: {} },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cycles).toHaveLength(0);
    });

    it('should pass for workflow with branches', () => {
      const steps: TestStep[] = [
        { stepSlug: 'trigger', nextSteps: { success: 'condition' } },
        {
          stepSlug: 'condition',
          nextSteps: { true: 'branch_a', false: 'branch_b' },
        },
        { stepSlug: 'branch_a', nextSteps: { success: 'end' } },
        { stepSlug: 'branch_b', nextSteps: { success: 'end' } },
        { stepSlug: 'end', nextSteps: {} },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cycles).toHaveLength(0);
    });

    it('should pass for workflow with noop termination', () => {
      const steps: TestStep[] = [
        { stepSlug: 'trigger', nextSteps: { success: 'action' } },
        { stepSlug: 'action', nextSteps: { success: 'noop', failure: 'noop' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for empty workflow', () => {
      const steps: Array<{
        stepSlug: string;
        nextSteps?: Record<string, string>;
      }> = [];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('invalid workflows (with cycles)', () => {
    it('should detect simple cycle (A → B → A)', () => {
      const steps = [
        { stepSlug: 'step_a', nextSteps: { success: 'step_b' } },
        { stepSlug: 'step_b', nextSteps: { success: 'step_a' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Circular dependency detected');
    });

    it('should detect self-referencing step (A → A)', () => {
      const steps = [
        { stepSlug: 'trigger', nextSteps: { success: 'loop_step' } },
        { stepSlug: 'loop_step', nextSteps: { success: 'loop_step' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.cycles).toContainEqual(['loop_step', 'loop_step']);
    });

    it('should detect complex multi-step cycle (A → B → C → D → B)', () => {
      const steps = [
        { stepSlug: 'step_a', nextSteps: { success: 'step_b' } },
        { stepSlug: 'step_b', nextSteps: { success: 'step_c' } },
        { stepSlug: 'step_c', nextSteps: { success: 'step_d' } },
        { stepSlug: 'step_d', nextSteps: { success: 'step_b' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should detect cycle in conditional branch without stepType info', () => {
      const steps: TestStep[] = [
        { stepSlug: 'trigger', nextSteps: { success: 'condition' } },
        {
          stepSlug: 'condition',
          nextSteps: { true: 'action', false: 'trigger' },
        },
        { stepSlug: 'action', nextSteps: {} },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('intentional loops (allowed cycles)', () => {
    it('should allow loop node with body steps pointing back', () => {
      const steps: TestStep[] = [
        {
          stepSlug: 'start',
          stepType: 'start',
          nextSteps: { success: 'fetch_data' },
        },
        {
          stepSlug: 'fetch_data',
          stepType: 'action',
          nextSteps: { success: 'loop_items' },
        },
        {
          stepSlug: 'loop_items',
          stepType: 'loop',
          nextSteps: { loop: 'process_item', done: 'finish' },
        },
        {
          stepSlug: 'process_item',
          stepType: 'action',
          nextSteps: { success: 'loop_items' },
        },
        {
          stepSlug: 'finish',
          stepType: 'action',
          nextSteps: { success: 'noop' },
        },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Intentional loop detected');
    });

    it('should allow condition-based pagination cycle', () => {
      const steps: TestStep[] = [
        {
          stepSlug: 'start',
          stepType: 'start',
          nextSteps: { success: 'discover_urls' },
        },
        {
          stepSlug: 'discover_urls',
          stepType: 'action',
          nextSteps: { success: 'register_urls' },
        },
        {
          stepSlug: 'register_urls',
          stepType: 'action',
          nextSteps: { success: 'check_has_more' },
        },
        {
          stepSlug: 'check_has_more',
          stepType: 'condition',
          nextSteps: { true: 'update_offset', false: 'finish' },
        },
        {
          stepSlug: 'update_offset',
          stepType: 'action',
          nextSteps: { success: 'discover_urls' },
        },
        {
          stepSlug: 'finish',
          stepType: 'action',
          nextSteps: { success: 'noop' },
        },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Intentional loop detected');
    });

    it('should allow condition cycle with stepType provided', () => {
      const steps: TestStep[] = [
        {
          stepSlug: 'trigger',
          stepType: 'start',
          nextSteps: { success: 'condition' },
        },
        {
          stepSlug: 'condition',
          stepType: 'condition',
          nextSteps: { true: 'action', false: 'trigger' },
        },
        { stepSlug: 'action', stepType: 'action', nextSteps: {} },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.cycles.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Intentional loop detected');
    });

    it('should still flag pure action-only cycles', () => {
      const steps: TestStep[] = [
        {
          stepSlug: 'action_a',
          stepType: 'action',
          nextSteps: { success: 'action_b' },
        },
        {
          stepSlug: 'action_b',
          stepType: 'action',
          nextSteps: { success: 'action_a' },
        },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Circular dependency detected');
    });

    it('should still flag self-referencing action step', () => {
      const steps: TestStep[] = [
        {
          stepSlug: 'start',
          stepType: 'start',
          nextSteps: { success: 'action' },
        },
        {
          stepSlug: 'action',
          stepType: 'action',
          nextSteps: { success: 'action' },
        },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle steps with no nextSteps property', () => {
      const steps = [
        { stepSlug: 'trigger', nextSteps: { success: 'action' } },
        { stepSlug: 'action' },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle steps with empty nextSteps', () => {
      const steps = [
        { stepSlug: 'trigger', nextSteps: {} },
        { stepSlug: 'orphan', nextSteps: {} },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should ignore references to non-existent steps (handled by other validator)', () => {
      const steps = [
        { stepSlug: 'trigger', nextSteps: { success: 'non_existent' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle multiple independent cycles', () => {
      const steps = [
        { stepSlug: 'cycle1_a', nextSteps: { success: 'cycle1_b' } },
        { stepSlug: 'cycle1_b', nextSteps: { success: 'cycle1_a' } },
        { stepSlug: 'cycle2_a', nextSteps: { success: 'cycle2_b' } },
        { stepSlug: 'cycle2_b', nextSteps: { success: 'cycle2_a' } },
      ];

      const result = validateCircularDependencies(steps);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThanOrEqual(2);
    });
  });
});
