import { describe, expect, it } from 'vitest';

import { withStored } from './label-options';

const OPTIONS = [
  { value: 'bug', label: 'bug' },
  { value: 'docs', label: 'docs' },
];

describe('withStored', () => {
  it('answers the options themselves when the project has every label', () => {
    expect(withStored(OPTIONS, [])).toBe(OPTIONS);
    expect(withStored(OPTIONS, ['docs', 'bug'])).toBe(OPTIONS);
  });

  it('adds each stored label the project no longer has, in stored order', () => {
    expect(withStored(OPTIONS, ['gone', 'bug', 'renamed'])).toEqual([
      ...OPTIONS,
      { value: 'gone', label: 'gone' },
      { value: 'renamed', label: 'renamed' },
    ]);
  });

  it('keeps a stored name spelled otherwise as its own option', () => {
    expect(withStored(OPTIONS, ['Bug'])).toEqual([
      ...OPTIONS,
      { value: 'Bug', label: 'Bug' },
    ]);
  });
});
