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
});
