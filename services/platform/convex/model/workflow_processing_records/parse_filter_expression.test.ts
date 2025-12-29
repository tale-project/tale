/**
 * Tests for JEXL AST-based filter expression parser
 */

import { describe, it, expect } from 'vitest';
import { parseFilterExpression } from './parse_filter_expression';

describe('parseFilterExpression', () => {
  describe('empty and invalid expressions', () => {
    it('should handle empty string', () => {
      const result = parseFilterExpression('');
      expect(result.conditions).toEqual([]);
      expect(result.hasComplexConditions).toBe(false);
      expect(result.equalityConditions).toEqual({});
    });

    it('should handle whitespace-only string', () => {
      const result = parseFilterExpression('   ');
      expect(result.conditions).toEqual([]);
      expect(result.hasComplexConditions).toBe(false);
    });

    it('should handle invalid JEXL expression', () => {
      const result = parseFilterExpression('invalid((((');
      expect(result.conditions).toEqual([]);
      expect(result.hasComplexConditions).toBe(true);
    });
  });

  describe('simple equality conditions', () => {
    it('should parse simple string equality', () => {
      const result = parseFilterExpression('status == "open"');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'status',
        operator: '==',
        value: 'open',
        isSimpleField: true,
      });
      expect(result.equalityConditions).toEqual({ status: 'open' });
      expect(result.hasComplexConditions).toBe(false);
    });

    it('should parse single-quoted string equality', () => {
      const result = parseFilterExpression("status == 'closed'");
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'status',
        operator: '==',
        value: 'closed',
        isSimpleField: true,
      });
    });

    it('should parse numeric equality', () => {
      const result = parseFilterExpression('priority == 5');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'priority',
        operator: '==',
        value: 5,
        isSimpleField: true,
      });
    });

    it('should parse boolean equality', () => {
      const result = parseFilterExpression('isActive == true');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'isActive',
        operator: '==',
        value: true,
        isSimpleField: true,
      });
    });

    it('should parse null equality', () => {
      const result = parseFilterExpression('metadata == null');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].value).toBe(null);
    });
  });

  describe('comparison operators', () => {
    it('should parse greater than', () => {
      const result = parseFilterExpression('count > 10');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'count',
        operator: '>',
        value: 10,
        isSimpleField: true,
      });
    });

    it('should parse greater than or equal', () => {
      const result = parseFilterExpression('age >= 18');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'age',
        operator: '>=',
        value: 18,
        isSimpleField: true,
      });
    });

    it('should parse less than', () => {
      const result = parseFilterExpression('temperature < 100');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].operator).toBe('<');
    });

    it('should parse less than or equal', () => {
      const result = parseFilterExpression('score <= 50');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].operator).toBe('<=');
    });

    it('should parse not equal', () => {
      const result = parseFilterExpression('status != "archived"');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'status',
        operator: '!=',
        value: 'archived',
        isSimpleField: true,
      });
    });
  });

  describe('multiple AND conditions', () => {
    it('should parse two equality conditions', () => {
      const result = parseFilterExpression('status == "open" && priority == "high"');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0]).toEqual({
        field: 'status',
        operator: '==',
        value: 'open',
        isSimpleField: true,
      });
      expect(result.conditions[1]).toEqual({
        field: 'priority',
        operator: '==',
        value: 'high',
        isSimpleField: true,
      });
      expect(result.equalityConditions).toEqual({
        status: 'open',
        priority: 'high',
      });
    });

    it('should parse three conditions', () => {
      const result = parseFilterExpression(
        'status == "open" && priority == 5 && isActive == true',
      );
      expect(result.conditions).toHaveLength(3);
    });

    it('should parse mixed equality and comparison', () => {
      const result = parseFilterExpression('status == "open" && count > 10');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0].operator).toBe('==');
      expect(result.conditions[1].operator).toBe('>');
    });
  });

  describe('nested field access', () => {
    it('should parse nested field with equality', () => {
      const result = parseFilterExpression('metadata.status == "active"');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toEqual({
        field: 'metadata.status',
        operator: '==',
        value: 'active',
        isSimpleField: false,
      });
    });

    it('should parse deeply nested field', () => {
      const result = parseFilterExpression('data.user.profile.age > 18');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].field).toBe('data.user.profile.age');
      expect(result.conditions[0].isSimpleField).toBe(false);
    });

    it('should parse mixed simple and nested fields', () => {
      const result = parseFilterExpression(
        'status == "open" && metadata.priority == "high"',
      );
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0].isSimpleField).toBe(true);
      expect(result.conditions[1].isSimpleField).toBe(false);
    });
  });

  describe('OR expressions', () => {
    it('should mark OR expression as complex', () => {
      const result = parseFilterExpression('status == "open" || status == "pending"');
      expect(result.hasComplexConditions).toBe(true);
      // OR expressions are not currently optimized for indexing
      expect(result.conditions).toEqual([]);
    });

    it('should mark complex OR with AND as complex', () => {
      const result = parseFilterExpression(
        '(status == "open" || status == "pending") && priority == "high"',
      );
      expect(result.hasComplexConditions).toBe(true);
    });
  });

  describe('complex expressions with function calls', () => {
    it('should extract equality but mark complex when functions present', () => {
      const result = parseFilterExpression(
        'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      );
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].field).toBe('status');
      expect(result.hasComplexConditions).toBe(true);
    });

    it('should mark pure function call as complex', () => {
      const result = parseFilterExpression('daysAgo(createdAt) > 7');
      expect(result.hasComplexConditions).toBe(true);
      expect(result.conditions).toEqual([]);
    });

    it('should handle transform pipes as complex', () => {
      const result = parseFilterExpression('tags | length > 5');
      expect(result.hasComplexConditions).toBe(true);
    });
  });

  describe('parentheses and grouping', () => {
    it('should handle simple parentheses with AND', () => {
      const result = parseFilterExpression('(status == "open") && (priority == 5)');
      expect(result.conditions).toHaveLength(2);
      expect(result.hasComplexConditions).toBe(false);
    });

    it('should handle nested parentheses with OR as complex', () => {
      const result = parseFilterExpression(
        '((status == "open" || status == "pending") && priority == 5)',
      );
      expect(result.hasComplexConditions).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle expression with only field reference', () => {
      const result = parseFilterExpression('isActive');
      expect(result.hasComplexConditions).toBe(true);
    });

    it('should handle ternary operator as complex', () => {
      const result = parseFilterExpression('status == "open" ? true : false');
      expect(result.hasComplexConditions).toBe(true);
    });

    it('should handle array literal as complex', () => {
      const result = parseFilterExpression('status in ["open", "pending"]');
      expect(result.hasComplexConditions).toBe(true);
    });

    it('should not extract conditions with complex right side', () => {
      const result = parseFilterExpression('status == someVariable');
      expect(result.hasComplexConditions).toBe(true);
      expect(result.conditions).toEqual([]);
    });

    it('should not extract conditions with function on left side', () => {
      const result = parseFilterExpression('upper(status) == "OPEN"');
      expect(result.hasComplexConditions).toBe(true);
      expect(result.conditions).toEqual([]);
    });
  });

  describe('real-world workflow filter expressions', () => {
    it('should parse conversation status filter', () => {
      const result = parseFilterExpression('status == "closed"');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].field).toBe('status');
      expect(result.equalityConditions).toEqual({ status: 'closed' });
    });

    it('should parse complex conversation filter', () => {
      const result = parseFilterExpression(
        'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      );
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0].field).toBe('status');
      expect(result.hasComplexConditions).toBe(true);
    });

    it('should parse approval filter', () => {
      const result = parseFilterExpression(
        'status == "pending" && resourceType == "document"',
      );
      expect(result.conditions).toHaveLength(2);
      expect(result.equalityConditions).toEqual({
        status: 'pending',
        resourceType: 'document',
      });
    });

    it('should parse priority range filter', () => {
      const result = parseFilterExpression('priority >= 5 && status == "open"');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions.some((c) => c.operator === '>=')).toBe(true);
      expect(result.conditions.some((c) => c.operator === '==')).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    it('should maintain equalityConditions for == operators', () => {
      const result = parseFilterExpression(
        'status == "open" && priority == 5 && count > 10',
      );
      expect(result.equalityConditions).toEqual({
        status: 'open',
        priority: 5,
      });
      // count > 10 should not be in equalityConditions
      expect(result.equalityConditions.count).toBeUndefined();
    });

    it('should have empty equalityConditions when no == operators', () => {
      const result = parseFilterExpression('count > 10 && age >= 18');
      expect(result.equalityConditions).toEqual({});
      expect(result.conditions).toHaveLength(2);
    });
  });
});
