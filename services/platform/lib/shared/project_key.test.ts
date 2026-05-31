import { describe, expect, it } from 'vitest';

import {
  deriveProjectKey,
  formatTaskIdentifier,
  isValidProjectKey,
  normalizeProjectKey,
} from './project_key';

describe('project_key', () => {
  describe('deriveProjectKey', () => {
    it('takes initials of the first words for a multi-word name', () => {
      expect(deriveProjectKey('Tale Platform')).toBe('TP');
      expect(deriveProjectKey('Q2 Sales Hiring')).toBe('QSH');
    });

    it('caps multi-word initials at three words', () => {
      expect(deriveProjectKey('one two three four five')).toBe('OTT');
    });

    it('takes the leading letters of a single word', () => {
      expect(deriveProjectKey('tale')).toBe('TAL');
      expect(deriveProjectKey('QA')).toBe('QA');
    });

    it('returns an empty string when there is nothing alphanumeric', () => {
      expect(deriveProjectKey('   ')).toBe('');
      expect(deriveProjectKey('!!!')).toBe('');
    });
  });

  describe('normalizeProjectKey', () => {
    it('uppercases, strips punctuation, and caps length', () => {
      expect(normalizeProjectKey('ta-le_1')).toBe('TALE1');
      expect(normalizeProjectKey('abcdefgh')).toBe('ABCDEF');
    });

    it('drops leading digits so the key starts with a letter', () => {
      expect(normalizeProjectKey('12ab')).toBe('AB');
    });
  });

  describe('isValidProjectKey', () => {
    it('accepts 2–6 char keys starting with a letter', () => {
      expect(isValidProjectKey('TAL')).toBe(true);
      expect(isValidProjectKey('QA')).toBe(true);
      expect(isValidProjectKey('A1B2C3')).toBe(true);
    });

    it('rejects too-short, too-long, digit-leading, or empty keys', () => {
      expect(isValidProjectKey('A')).toBe(false);
      expect(isValidProjectKey('ABCDEFG')).toBe(false);
      expect(isValidProjectKey('1AB')).toBe(false);
      expect(isValidProjectKey('')).toBe(false);
    });
  });

  describe('formatTaskIdentifier', () => {
    it('joins key and number', () => {
      expect(formatTaskIdentifier('TAL', 7)).toBe('TAL-7');
    });

    it('returns null when the key or number is missing', () => {
      expect(formatTaskIdentifier(null, 7)).toBeNull();
      expect(formatTaskIdentifier('TAL', null)).toBeNull();
      expect(formatTaskIdentifier(undefined, undefined)).toBeNull();
      expect(formatTaskIdentifier('TAL', 0)).toBe('TAL-0');
    });
  });
});
