import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEnteringKeys } from './use-entering-keys';

function setup(initial: {
  keys: readonly string[];
  identity?: string;
  loading?: boolean;
}) {
  return renderHook(
    ({ keys, identity, loading }) => useEnteringKeys(keys, identity, loading),
    {
      initialProps: {
        keys: initial.keys,
        identity: initial.identity ?? 'all',
        loading: initial.loading ?? false,
      },
    },
  );
}

describe('useEnteringKeys', () => {
  it('announces nothing on the first paint of a list', () => {
    const { result } = setup({ keys: ['a', 'b'] });
    expect(result.current.size).toBe(0);
  });

  it('marks a row that joins the list while it is open', () => {
    const { result, rerender } = setup({ keys: ['a', 'b'] });
    rerender({ keys: ['c', 'a', 'b'], identity: 'all', loading: false });
    expect([...result.current]).toEqual(['c']);
  });

  it('announces nothing when the list is swapped for another', () => {
    const { result, rerender } = setup({ keys: ['a'] });
    rerender({ keys: ['a', 't1', 't2'], identity: 'tasks', loading: false });
    expect(result.current.size).toBe(0);
  });

  it('waits for the first loaded page before anything counts as arriving', () => {
    const { result, rerender } = setup({ keys: [], loading: true });
    rerender({ keys: ['a', 'b'], identity: 'all', loading: false });
    expect(result.current.size).toBe(0);
    rerender({ keys: ['n', 'a', 'b'], identity: 'all', loading: false });
    expect([...result.current]).toEqual(['n']);
  });

  it('lets a refilled list in without a cascade of slides', () => {
    const { result, rerender } = setup({ keys: ['a'] });
    rerender({
      keys: ['a', 'b', 'c', 'd', 'e', 'f'],
      identity: 'all',
      loading: false,
    });
    expect(result.current.size).toBe(0);
  });
});
