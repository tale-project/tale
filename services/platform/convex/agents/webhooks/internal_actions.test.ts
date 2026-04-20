import { describe, expect, it } from 'vitest';

import { mergeSystemInstructions } from './internal_actions';

describe('mergeSystemInstructions', () => {
  it('returns the agent text alone when no client text is provided', () => {
    expect(mergeSystemInstructions('You are agent A.', undefined)).toBe(
      'You are agent A.',
    );
    expect(mergeSystemInstructions('You are agent A.', '')).toBe(
      'You are agent A.',
    );
  });

  it('returns the client text alone when agent instructions are empty', () => {
    expect(mergeSystemInstructions('', 'client-side rules')).toBe(
      'client-side rules',
    );
    expect(mergeSystemInstructions(undefined, 'client-side rules')).toBe(
      'client-side rules',
    );
  });

  it('concatenates agent-first with the `\\n\\n---\\n\\n` separator', () => {
    expect(mergeSystemInstructions('A', 'B')).toBe('A\n\n---\n\nB');
  });

  it('trims both halves before merging', () => {
    expect(mergeSystemInstructions('  A  ', '\n\nB\n')).toBe('A\n\n---\n\nB');
  });

  it('treats whitespace-only strings as empty (no dangling separator)', () => {
    expect(mergeSystemInstructions('   ', 'B')).toBe('B');
    expect(mergeSystemInstructions('A', '   ')).toBe('A');
    expect(mergeSystemInstructions('   ', '   ')).toBe('');
  });

  it('preserves internal whitespace and line breaks', () => {
    const agent = 'Line1\n\nLine2';
    const client = 'C1\nC2';
    expect(mergeSystemInstructions(agent, client)).toBe(
      'Line1\n\nLine2\n\n---\n\nC1\nC2',
    );
  });
});
