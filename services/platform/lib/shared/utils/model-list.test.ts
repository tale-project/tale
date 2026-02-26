import { describe, expect, it } from 'vitest';

import {
  getFirstModel,
  getFirstModelOrThrow,
  parseModelList,
} from './model-list';

describe('parseModelList', () => {
  it('returns empty array for undefined', () => {
    expect(parseModelList(undefined)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(parseModelList(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseModelList('')).toEqual([]);
  });

  it('parses a single model', () => {
    expect(parseModelList('model-a')).toEqual(['model-a']);
  });

  it('parses multiple models', () => {
    expect(parseModelList('model-a,model-b,model-c')).toEqual([
      'model-a',
      'model-b',
      'model-c',
    ]);
  });

  it('trims whitespace around models', () => {
    expect(parseModelList(' model-a , model-b ')).toEqual([
      'model-a',
      'model-b',
    ]);
  });

  it('filters out empty segments', () => {
    expect(parseModelList('model-a,,model-b')).toEqual(['model-a', 'model-b']);
  });

  it('handles trailing comma', () => {
    expect(parseModelList('model-a,')).toEqual(['model-a']);
  });

  it('preserves model paths with slashes', () => {
    expect(parseModelList('openai/gpt-5.2,anthropic/claude-opus')).toEqual([
      'openai/gpt-5.2',
      'anthropic/claude-opus',
    ]);
  });
});

describe('getFirstModel', () => {
  it('returns undefined for undefined input', () => {
    expect(getFirstModel(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getFirstModel('')).toBeUndefined();
  });

  it('returns the first model from a single value', () => {
    expect(getFirstModel('model-a')).toBe('model-a');
  });

  it('returns the first model from a comma-separated list', () => {
    expect(getFirstModel('model-a,model-b')).toBe('model-a');
  });

  it('trims whitespace', () => {
    expect(getFirstModel(' model-a , model-b ')).toBe('model-a');
  });
});

describe('getFirstModelOrThrow', () => {
  it('returns the first model when available', () => {
    expect(getFirstModelOrThrow('model-a,model-b', 'OPENAI_MODEL')).toBe(
      'model-a',
    );
  });

  it('throws for undefined', () => {
    expect(() => getFirstModelOrThrow(undefined, 'OPENAI_MODEL')).toThrow(
      'OPENAI_MODEL',
    );
  });

  it('throws for empty string', () => {
    expect(() => getFirstModelOrThrow('', 'OPENAI_MODEL')).toThrow(
      'OPENAI_MODEL',
    );
  });

  it('throws for whitespace-only string', () => {
    expect(() => getFirstModelOrThrow('  ,  ', 'OPENAI_MODEL')).toThrow(
      'OPENAI_MODEL',
    );
  });
});
