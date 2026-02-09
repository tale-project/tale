/**
 * Test: Depth Sanitization Utilities
 *
 * Tests for sanitizeDepth and calculateDepth functions that ensure
 * workflow execution output stays within jsonValueValidator's nesting depth limit.
 */

import { describe, it, expect } from 'vitest';

import {
  sanitizeDepth,
  calculateDepth,
  MAX_SAFE_DEPTH,
  TruncationMarker,
} from './sanitize_depth';

describe('sanitizeDepth', () => {
  describe('primitives', () => {
    it('should pass through strings unchanged', () => {
      expect(sanitizeDepth('hello')).toBe('hello');
    });

    it('should pass through numbers unchanged', () => {
      expect(sanitizeDepth(123)).toBe(123);
      expect(sanitizeDepth(0)).toBe(0);
      expect(sanitizeDepth(-1.5)).toBe(-1.5);
    });

    it('should pass through booleans unchanged', () => {
      expect(sanitizeDepth(true)).toBe(true);
      expect(sanitizeDepth(false)).toBe(false);
    });

    it('should pass through null and undefined unchanged', () => {
      expect(sanitizeDepth(null)).toBe(null);
      expect(sanitizeDepth(undefined)).toBe(undefined);
    });
  });

  describe('shallow structures', () => {
    it('should handle empty objects unchanged', () => {
      expect(sanitizeDepth({})).toEqual({});
    });

    it('should handle empty arrays unchanged', () => {
      expect(sanitizeDepth([])).toEqual([]);
    });

    it('should handle shallow objects unchanged', () => {
      const input = { a: 1, b: 'test', c: true };
      expect(sanitizeDepth(input)).toEqual(input);
    });

    it('should handle shallow arrays unchanged', () => {
      const input = [1, 'test', true, null];
      expect(sanitizeDepth(input)).toEqual(input);
    });
  });

  describe('deep structures', () => {
    it('should truncate objects at max depth', () => {
      const deep = {
        l1: { l2: { l3: { l4: { l5: { l6: { l7: 'too deep' } } } } } },
      };
      const result = sanitizeDepth(deep, 0, 6) as Record<string, unknown>;

      const truncated = (
        result.l1 as {
          l2: { l3: { l4: { l5: { l6: TruncationMarker } } } };
        }
      ).l2.l3.l4.l5.l6;
      expect(truncated._truncated).toBe(true);
      expect(truncated._originalType).toBe('object');
    });

    it('should truncate arrays at max depth with item count', () => {
      const deep = {
        l1: { l2: { l3: { l4: { l5: { l6: [1, 2, 3, 4, 5] } } } } },
      };
      const result = sanitizeDepth(deep, 0, 6) as Record<string, unknown>;

      const truncated = (
        result.l1 as {
          l2: { l3: { l4: { l5: { l6: TruncationMarker } } } };
        }
      ).l2.l3.l4.l5.l6;
      expect(truncated._truncated).toBe(true);
      expect(truncated._originalType).toBe('array');
      expect(truncated._itemCount).toBe(5);
    });

    it('should preserve structure up to max depth', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    level7: 'deep value',
                  },
                },
              },
            },
          },
        },
      };

      const result = sanitizeDepth(input, 0, 5) as Record<string, unknown>;

      // Levels 1-4 should be preserved
      expect(result).toHaveProperty('level1.level2.level3.level4');

      // Level 5 should be truncated
      const l5 = (
        result.level1 as {
          level2: { level3: { level4: { level5: TruncationMarker } } };
        }
      ).level2.level3.level4.level5;
      expect(l5._truncated).toBe(true);
    });

    it('should handle mixed arrays and objects', () => {
      const input = {
        data: [
          {
            nested: {
              deep: {
                value: [1, 2, 3],
              },
            },
          },
        ],
      };

      const result = sanitizeDepth(input, 0, 4) as Record<string, unknown>;

      // Array element's nested.deep should be truncated
      const firstItem = (result.data as Array<Record<string, unknown>>)[0];
      const deepValue = (firstItem.nested as { deep: TruncationMarker }).deep;
      expect(deepValue._truncated).toBe(true);
    });
  });

  describe('with custom max depth', () => {
    it('should respect custom max depth of 2', () => {
      const input = { a: { b: { c: 'value' } } };
      const result = sanitizeDepth(input, 0, 2);

      expect(result).toEqual({
        a: {
          b: { _truncated: true, _originalType: 'object' },
        },
      });
    });

    it('should allow deeper nesting with higher max depth', () => {
      const input = { a: { b: { c: { d: 'value' } } } };
      const result = sanitizeDepth(input, 0, 10);

      expect(result).toEqual(input);
    });
  });

  describe('default MAX_SAFE_DEPTH', () => {
    it('should be 6', () => {
      expect(MAX_SAFE_DEPTH).toBe(6);
    });

    it('should sanitize structures deeper than 6 levels by default', () => {
      const input = {
        l1: { l2: { l3: { l4: { l5: { l6: { l7: 'deep' } } } } } },
      };
      const result = sanitizeDepth(input);

      const l6 = (
        result as {
          l1: {
            l2: { l3: { l4: { l5: { l6: TruncationMarker } } } };
          };
        }
      ).l1.l2.l3.l4.l5.l6;
      expect(l6._truncated).toBe(true);
    });
  });
});

describe('calculateDepth', () => {
  describe('primitives', () => {
    it('should return 0 for strings', () => {
      expect(calculateDepth('hello')).toBe(0);
    });

    it('should return 0 for numbers', () => {
      expect(calculateDepth(123)).toBe(0);
    });

    it('should return 0 for booleans', () => {
      expect(calculateDepth(true)).toBe(0);
    });

    it('should return 0 for null', () => {
      expect(calculateDepth(null)).toBe(0);
    });

    it('should return 0 for undefined', () => {
      expect(calculateDepth(undefined)).toBe(0);
    });
  });

  describe('objects', () => {
    it('should return 1 for empty object', () => {
      expect(calculateDepth({})).toBe(1);
    });

    it('should return 1 for flat object', () => {
      expect(calculateDepth({ a: 1, b: 2 })).toBe(1);
    });

    it('should return correct depth for nested objects', () => {
      expect(calculateDepth({ a: { b: 1 } })).toBe(2);
      expect(calculateDepth({ a: { b: { c: 1 } } })).toBe(3);
      expect(calculateDepth({ a: { b: { c: { d: 1 } } } })).toBe(4);
    });
  });

  describe('arrays', () => {
    it('should return 1 for empty array', () => {
      expect(calculateDepth([])).toBe(1);
    });

    it('should return 1 for flat array', () => {
      expect(calculateDepth([1, 2, 3])).toBe(1);
    });

    it('should return correct depth for nested arrays', () => {
      expect(calculateDepth([[1]])).toBe(2);
      expect(calculateDepth([[[1]]])).toBe(3);
    });
  });

  describe('mixed structures', () => {
    it('should calculate max depth across branches', () => {
      const input = {
        shallow: 1,
        deep: {
          nested: {
            value: 'deep',
          },
        },
      };
      expect(calculateDepth(input)).toBe(3);
    });

    it('should handle arrays within objects', () => {
      const input = {
        data: [
          {
            items: [1, 2, 3],
          },
        ],
      };
      // depth: root(1) > data array(2) > object element(3) > items array(4)
      expect(calculateDepth(input)).toBe(4);
    });

    it('should find the deepest path in complex structures', () => {
      const input = {
        a: { b: 1 },
        c: { d: { e: { f: { g: 'deep' } } } },
        h: [1, 2, 3],
      };
      expect(calculateDepth(input)).toBe(5);
    });
  });

  describe('workflow-like structures', () => {
    it('should calculate depth for typical workflow output', () => {
      const workflowOutput = {
        steps: {
          fetch_data: {
            output: {
              data: {
                result: {
                  items: [
                    {
                      address: {
                        billing: {
                          street: '123 Main St',
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      };
      // steps > fetch_data > output > data > result > items > [0] > address > billing > street
      expect(calculateDepth(workflowOutput)).toBe(10);
    });
  });
});
