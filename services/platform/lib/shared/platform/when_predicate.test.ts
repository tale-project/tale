import { describe, expect, it } from 'vitest';

import { evaluateWhen } from './when_predicate';

describe('evaluateWhen', () => {
  const item = { status: 'open', priority: 'high', count: 3, done: false };

  it('absent / empty predicate is always true', () => {
    expect(evaluateWhen(undefined, item)).toBe(true);
    expect(evaluateWhen('  ', item)).toBe(true);
  });

  it('equality + inequality (string-coerced)', () => {
    expect(evaluateWhen('status == open', item)).toBe(true);
    expect(evaluateWhen("status == 'open'", item)).toBe(true);
    expect(evaluateWhen('status != closed', item)).toBe(true);
    expect(evaluateWhen('status == closed', item)).toBe(false);
  });

  it('numeric comparisons', () => {
    expect(evaluateWhen('count > 2', item)).toBe(true);
    expect(evaluateWhen('count >= 3', item)).toBe(true);
    expect(evaluateWhen('count < 3', item)).toBe(false);
  });

  it('bare-field truthiness + negation', () => {
    expect(evaluateWhen('priority', item)).toBe(true);
    expect(evaluateWhen('done', item)).toBe(false);
    expect(evaluateWhen('!done', item)).toBe(true);
  });

  it('AND / OR composition', () => {
    expect(evaluateWhen('status == open && priority == high', item)).toBe(true);
    expect(evaluateWhen('status == open && priority == low', item)).toBe(false);
    expect(evaluateWhen('status == closed || count == 3', item)).toBe(true);
  });

  it('fails closed on a malformed predicate', () => {
    expect(evaluateWhen('status ==', item)).toBe(false);
    expect(evaluateWhen('1 + 1', item)).toBe(false);
  });
});
