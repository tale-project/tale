import { describe, expect, it } from 'vitest';

import { rankTokens, scoreText } from '../rank';

describe('rankTokens', () => {
  it('lowercases and splits on whitespace, dropping blanks', () => {
    expect(rankTokens('  Alpha   Launch ')).toEqual(['alpha', 'launch']);
    expect(rankTokens('')).toEqual([]);
  });
});

describe('scoreText', () => {
  it('scores every text equally for a blank query', () => {
    expect(scoreText('anything', [])).toBe(1);
  });

  it('requires every token to be present (AND semantics)', () => {
    expect(
      scoreText('Launch plan: Alpha', rankTokens('alpha launch')),
    ).toBeGreaterThan(0);
    expect(scoreText('Launch plan: Alpha', rankTokens('alpha beta'))).toBe(0);
  });

  it('ranks exact > prefix > word-prefix > substring', () => {
    const score = (text: string) => scoreText(text, rankTokens('config'));
    expect(score('config')).toBeGreaterThan(score('configuration'));
    expect(score('configuration')).toBeGreaterThan(score('my config tool'));
    expect(score('my config tool')).toBeGreaterThan(score('reconfigure'));
    expect(score('unrelated')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(scoreText('Alpha', rankTokens('alpha'))).toBe(4);
  });
});
