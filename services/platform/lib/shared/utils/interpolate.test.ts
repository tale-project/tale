import { describe, expect, it } from 'vitest';

import { interpolateTemplate } from './interpolate';

describe('interpolateTemplate', () => {
  it('fills named placeholders from params', () => {
    expect(
      interpolateTemplate('Resolve {title} (#{number}) at {url}', {
        title: 'Fix the bug',
        number: 42,
        url: 'https://x/1',
      }),
    ).toBe('Resolve Fix the bug (#42) at https://x/1');
  });

  it('leaves unknown placeholders verbatim (gap is visible, not blanked)', () => {
    expect(interpolateTemplate('Hi {name} {missing}', { name: 'Lee' })).toBe(
      'Hi Lee {missing}',
    );
  });

  it('stringifies non-string values safely', () => {
    expect(
      interpolateTemplate('{n} {b} {o}', { n: 3, b: true, o: { a: 1 } }),
    ).toBe('3 true {"a":1}');
  });

  it('applies the transform to interpolated values only, not template markup', () => {
    expect(
      interpolateTemplate('*{x}*', { x: 'a&b' }, (s) =>
        s.replace(/&/g, '&amp;'),
      ),
    ).toBe('*a&amp;b*');
  });

  it('returns the template unchanged when there are no placeholders', () => {
    expect(interpolateTemplate('plain text', { a: 1 })).toBe('plain text');
  });
});
