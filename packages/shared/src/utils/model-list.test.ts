import { describe, expect, it } from 'vitest';

import {
  getFirstModel,
  getFirstModelOrThrow,
  parseModelList,
} from './model-list.ts';

describe('parseModelList', () => {
  it('returns empty for null', () => {
    expect(parseModelList(null)).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(parseModelList('')).toEqual([]);
  });

  it('parses a single model', () => {
    expect(parseModelList('gpt-4')).toEqual(['gpt-4']);
  });

  it('parses multiple models', () => {
    expect(parseModelList('gpt-4,gpt-3.5-turbo')).toEqual([
      'gpt-4',
      'gpt-3.5-turbo',
    ]);
  });

  it('strips whitespace', () => {
    expect(parseModelList('  gpt-4 , gpt-3.5-turbo  ')).toEqual([
      'gpt-4',
      'gpt-3.5-turbo',
    ]);
  });

  it('skips empty entries', () => {
    expect(parseModelList('gpt-4,,gpt-3.5-turbo,')).toEqual([
      'gpt-4',
      'gpt-3.5-turbo',
    ]);
  });

  it('returns empty when all entries are empty', () => {
    expect(parseModelList(',,,')).toEqual([]);
  });
});

describe('getFirstModel', () => {
  it('returns null for null', () => {
    expect(getFirstModel(null)).toBeNull();
  });

  it('returns null for empty', () => {
    expect(getFirstModel('')).toBeNull();
  });

  it('returns the first model', () => {
    expect(getFirstModel('gpt-4,gpt-3.5-turbo')).toBe('gpt-4');
  });

  it('returns the only model', () => {
    expect(getFirstModel('gpt-4')).toBe('gpt-4');
  });
});

describe('getFirstModelOrThrow', () => {
  it('returns the first model', () => {
    expect(getFirstModelOrThrow('gpt-4,gpt-3.5-turbo', 'TEST_VAR')).toBe(
      'gpt-4',
    );
  });

  it('throws on null', () => {
    expect(() => getFirstModelOrThrow(null, 'TEST_VAR')).toThrow('TEST_VAR');
  });

  it('throws on empty', () => {
    expect(() => getFirstModelOrThrow('', 'MY_MODEL')).toThrow('MY_MODEL');
  });
});
