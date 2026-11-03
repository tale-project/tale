import { describe, expect, it } from 'vitest';

import { mergeSessionChoices } from './session-choices';

describe('mergeSessionChoices', () => {
  it('lists each session once, the first source that names it winning', () => {
    const merged = mergeSessionChoices(
      [{ id: 1, name: 'one' }],
      [
        { id: 1, name: 'renamed' },
        { id: 2, name: 'two' },
      ],
    );
    expect(merged).toEqual([
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
    ]);
  });

  it('orders by name, numbers as numbers', () => {
    const merged = mergeSessionChoices([
      { id: 10, name: '10' },
      { id: 2, name: '2' },
      { id: 3, name: 'Shop' },
      { id: 4, name: '0001' },
    ]);
    expect(merged.map((session) => session.name)).toEqual([
      '0001',
      '2',
      '10',
      'Shop',
    ]);
  });

  it('keeps sessions with the same name apart, by id', () => {
    const merged = mergeSessionChoices([
      { id: 9, name: 'same' },
      { id: 4, name: 'same' },
    ]);
    expect(merged.map((session) => session.id)).toEqual([4, 9]);
  });

  it('copies the sessions, leaving the sources as they were', () => {
    const source = [{ id: 1, name: 'one', extra: true }];
    const [first] = mergeSessionChoices(source);
    expect(first).toEqual({ id: 1, name: 'one' });
    expect(source[0]).toHaveProperty('extra', true);
  });

  it('is empty without sources', () => {
    expect(mergeSessionChoices()).toEqual([]);
  });
});
