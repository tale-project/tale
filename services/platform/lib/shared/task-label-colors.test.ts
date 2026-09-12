import { describe, expect, it } from 'vitest';

import { defaultTaskLabelColor } from './task-label-colors';

/** The catalog keeps a label's spelling and is unique without regard to
 * case, so the colour a name earns cannot depend on its case either. */
describe('defaultTaskLabelColor', () => {
  it('gives the predefined trio their colour in any spelling', () => {
    expect(defaultTaskLabelColor('bug')).toBe('red');
    expect(defaultTaskLabelColor('Bug')).toBe('red');
    expect(defaultTaskLabelColor(' FEATURE ')).toBe('purple');
  });

  it('hashes a custom name the same in every case', () => {
    expect(defaultTaskLabelColor('MixedCase-ÄÖÜ')).toBe(
      defaultTaskLabelColor('mixedcase-äöü'),
    );
    expect(defaultTaskLabelColor('P1')).toBe(defaultTaskLabelColor('p1'));
  });
});
