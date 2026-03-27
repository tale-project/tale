import { describe, expect, it } from 'vitest';

import { jexlInstance } from './jexl_instance';

describe('jexl_instance', () => {
  describe('|isoDate transform', () => {
    it('converts millisecond timestamp to ISO 8601 string', () => {
      const timestamp = 1705312200000;
      const result = jexlInstance.evalSync('val|isoDate', { val: timestamp });
      expect(result).toBe(new Date(timestamp).toISOString());
    });

    it('converts seconds timestamp to ISO 8601 string', () => {
      const timestampSec = 1705312200;
      const result = jexlInstance.evalSync('val|isoDate', {
        val: timestampSec,
      });
      expect(result).toBe(new Date(timestampSec * 1000).toISOString());
    });

    it('converts ISO date string to ISO 8601 string', () => {
      const result = jexlInstance.evalSync('val|isoDate', {
        val: '2024-01-15T10:30:00Z',
      });
      expect(result).toBe('2024-01-15T10:30:00.000Z');
    });

    it('returns empty string for null', () => {
      const result = jexlInstance.evalSync('val|isoDate', { val: null });
      expect(result).toBe('');
    });

    it('returns empty string for undefined', () => {
      const result = jexlInstance.evalSync('val|isoDate', { val: undefined });
      expect(result).toBe('');
    });

    it('returns empty string for invalid input', () => {
      const result = jexlInstance.evalSync('val|isoDate', {
        val: 'not-a-date',
      });
      expect(result).toBe('');
    });
  });

  describe('|concat transform', () => {
    it('concatenates two arrays', () => {
      const result = jexlInstance.evalSync('a|concat(b)', {
        a: [1, 2],
        b: [3, 4],
      });
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it('handles empty first array', () => {
      const result = jexlInstance.evalSync('a|concat(b)', {
        a: [],
        b: ['hello'],
      });
      expect(result).toEqual(['hello']);
    });

    it('preserves actual newlines in concatenated string elements', () => {
      const result = jexlInstance.evalSync(
        "a|concat(['## Title' + sep + 'Content'])",
        {
          a: [],
          sep: '\n\n---\n\n',
        },
      );
      expect(result).toEqual(['## Title\n\n---\n\nContent']);
    });
  });

  describe('|join transform', () => {
    it('joins array with separator containing newlines', () => {
      const result = jexlInstance.evalSync('a|join(sep)', {
        a: ['Section 1', 'Section 2'],
        sep: '\n\n---\n\n',
      });
      expect(result).toBe('Section 1\n\n---\n\nSection 2');
    });
  });

  describe('|chunk transform', () => {
    it('splits an array into chunks of given size', () => {
      const result = jexlInstance.evalSync('a|chunk(2)', {
        a: [1, 2, 3, 4, 5],
      });
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('handles array evenly divisible by chunk size', () => {
      const result = jexlInstance.evalSync('a|chunk(3)', {
        a: [1, 2, 3, 6, 7, 8],
      });
      expect(result).toEqual([
        [1, 2, 3],
        [6, 7, 8],
      ]);
    });

    it('returns single chunk when size >= array length', () => {
      const result = jexlInstance.evalSync('a|chunk(10)', {
        a: [1, 2, 3],
      });
      expect(result).toEqual([[1, 2, 3]]);
    });

    it('returns empty array for non-array input', () => {
      const result = jexlInstance.evalSync('a|chunk(2)', { a: 'not-array' });
      expect(result).toEqual([]);
    });

    it('chains with filterBy', () => {
      const result = jexlInstance.evalSync(
        'items|filterBy("active", true)|chunk(2)',
        {
          items: [
            { id: 1, active: true },
            { id: 2, active: false },
            { id: 3, active: true },
            { id: 4, active: true },
          ],
        },
      );
      expect(result).toEqual([
        [
          { id: 1, active: true },
          { id: 3, active: true },
        ],
        [{ id: 4, active: true }],
      ]);
    });
  });

  describe('JEXL string literal behavior', () => {
    it('handles actual newline characters in string literals', () => {
      const result = jexlInstance.evalSync("'hello\nworld'");
      expect(result).toBe('hello\nworld');
    });

    it('does NOT interpret backslash-n as newline in string literals', () => {
      const result = jexlInstance.evalSync("'hello\\nworld'");
      expect(result).toBe('hello\\nworld');
    });
  });
});
