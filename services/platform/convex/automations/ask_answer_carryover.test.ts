/**
 * The answered-ask carryover a re-kicked agent turn folds into its prompt.
 * What these pin: a first kick (no answered asks) leaves the authored prompt
 * byte-identical, and a retry carries every answered round verbatim, oldest
 * first, framed as settled decisions — the regression is the live incident
 * where a retry re-asked the operator the questions they had just answered.
 */

import { describe, expect, it } from 'vitest';

import { promptWithAnsweredAsks } from './ask_answer_carryover';

const PROMPT = 'Repair the client setup for period 2026Q2.';

describe('promptWithAnsweredAsks', () => {
  it('returns the prompt untouched when nothing was answered', () => {
    expect(promptWithAnsweredAsks(PROMPT, [])).toBe(PROMPT);
  });

  it('appends question and answer framed as standing decisions', () => {
    const merged = promptWithAnsweredAsks(PROMPT, [
      {
        question: 'Deduct invoice 26-0347 in Q2 or correct Q1?',
        answer: 'Deduct in Q2, booked 01.04.2026.',
      },
    ]);
    expect(merged.startsWith(PROMPT)).toBe(true);
    expect(merged).toContain('Deduct invoice 26-0347 in Q2 or correct Q1?');
    expect(merged).toContain('Deduct in Q2, booked 01.04.2026.');
    expect(merged).toContain('do NOT ask these questions again');
  });

  it('keeps multiple answered rounds in the given (oldest-first) order', () => {
    const merged = promptWithAnsweredAsks(PROMPT, [
      { question: 'First round?', answer: 'First answer.' },
      { question: 'Second round?', answer: 'Second answer.' },
    ]);
    expect(merged.indexOf('First round?')).toBeGreaterThan(-1);
    expect(merged.indexOf('First round?')).toBeLessThan(
      merged.indexOf('Second round?'),
    );
    expect(merged.indexOf('First answer.')).toBeLessThan(
      merged.indexOf('Second answer.'),
    );
  });
});
