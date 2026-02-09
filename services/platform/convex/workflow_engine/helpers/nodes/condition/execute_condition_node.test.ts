import { describe, it, expect } from 'vitest';

import { executeConditionNode } from './execute_condition_node';

describe('executeConditionNode', () => {
  describe('port routing', () => {
    it('should return port "true" when expression evaluates to true', () => {
      const result = executeConditionNode(
        { expression: 'status == "active"' },
        { status: 'active' },
      );

      expect(result.port).toBe('true');
    });

    it('should return port "false" when expression evaluates to false', () => {
      const result = executeConditionNode(
        { expression: 'status == "active"' },
        { status: 'inactive' },
      );

      expect(result.port).toBe('false');
    });
  });

  describe('output format', () => {
    it('should include passed boolean in output data', () => {
      const result = executeConditionNode({ expression: '1 == 1' }, {});

      expect(result.output.type).toBe('condition');
      const data = result.output.data as Record<string, unknown>;
      expect(data.passed).toBe(true);
      expect(data.expression).toBe('1 == 1');
    });

    it('should include condition description in meta', () => {
      const result = executeConditionNode({ expression: 'x > 5' }, { x: 10 });

      const meta = result.output.meta as Record<string, unknown>;
      expect(meta.conditionDescription).toContain('x > 5');
    });

    it('should include variables from config in meta', () => {
      const configVars = { threshold: 100 };
      const result = executeConditionNode(
        { expression: '1 == 1', variables: configVars },
        {},
      );

      const meta = result.output.meta as Record<string, unknown>;
      expect(meta.variablesFromConfig).toEqual(configVars);
    });
  });

  describe('expression handling', () => {
    it('should default to "false" when expression is empty', () => {
      const result = executeConditionNode({ expression: '' }, {});

      expect(result.port).toBe('false');
    });

    it('should default to "false" when expression is undefined', () => {
      const result = executeConditionNode({}, {});

      expect(result.port).toBe('false');
    });

    it('should evaluate complex expressions with nested variables', () => {
      const result = executeConditionNode(
        { expression: 'user.age >= 18 && user.verified == true' },
        { user: { age: 25, verified: true } },
      );

      expect(result.port).toBe('true');
    });

    it('should evaluate numeric comparisons', () => {
      const result = executeConditionNode(
        { expression: 'count > 0' },
        { count: 5 },
      );

      expect(result.port).toBe('true');
    });

    it('should throw when expression returns non-boolean', () => {
      expect(() => executeConditionNode({ expression: '"hello"' }, {})).toThrow(
        'Expression must return boolean',
      );
    });
  });
});
