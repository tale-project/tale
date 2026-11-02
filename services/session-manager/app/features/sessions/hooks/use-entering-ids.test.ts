import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEnteringIds } from './use-entering-ids';

function enteringOver(initial: { ids: number[]; loading: boolean }) {
  return renderHook((props) => useEnteringIds(props.ids, props.loading), {
    initialProps: initial,
  });
}

describe('useEnteringIds', () => {
  it('announces nothing for the first rows of a list', () => {
    const { result } = enteringOver({ ids: [3, 2, 1], loading: false });
    expect([...result.current]).toEqual([]);
  });

  it('announces nothing while the first answer is awaited', () => {
    const { result, rerender } = enteringOver({ ids: [], loading: true });
    rerender({ ids: [2, 1], loading: false });
    expect([...result.current]).toEqual([]);
  });

  it('announces a session that joined the open list', () => {
    const { result, rerender } = enteringOver({ ids: [2, 1], loading: false });
    rerender({ ids: [3, 2, 1], loading: false });
    expect([...result.current]).toEqual([3]);
  });

  it('announces nothing when a page of older sessions arrives', () => {
    const { result, rerender } = enteringOver({ ids: [9, 8], loading: false });
    rerender({ ids: [9, 8, 7, 6, 5, 4], loading: false });
    expect([...result.current]).toEqual([]);
  });

  it('announces nothing when the same sessions come back', () => {
    const { result, rerender } = enteringOver({ ids: [2, 1], loading: false });
    rerender({ ids: [2, 1], loading: false });
    expect([...result.current]).toEqual([]);
  });
});
