import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { usePersistedState } from './use-persisted-state';

beforeEach(() => {
  localStorage.clear();
});

describe('usePersistedState', () => {
  it('returns initialValue when localStorage is empty', () => {
    const { result } = renderHook(() => usePersistedState('test-key', 'hello'));

    expect(result.current[0]).toBe('hello');
  });

  it('reads from localStorage synchronously on first render', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'));

    const { result } = renderHook(() =>
      usePersistedState('test-key', 'default'),
    );

    // Lazy useState initializer reads localStorage during initial render —
    // no post-mount hydration step, so consumers never observe the default.
    expect(result.current[0]).toBe('stored-value');
  });

  it('does not write the initial value back to localStorage on mount', () => {
    renderHook(() => usePersistedState('test-key', 'default'));

    // First-mount persist must be a no-op: a hook that's never been written
    // to should not echo its initial value to storage (would otherwise
    // pollute the key and trigger spurious storage events).
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('persists value changes to localStorage', () => {
    const { result } = renderHook(() => usePersistedState('test-key', ''));

    act(() => {
      result.current[1]('new-value');
    });

    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('new-value'));
  });

  it('clears value and removes from localStorage', () => {
    localStorage.setItem('test-key', JSON.stringify('stored'));

    const { result } = renderHook(() => usePersistedState('test-key', ''));

    act(() => {
      result.current[2]();
    });

    expect(result.current[0]).toBe('');
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  describe('dynamic key changes', () => {
    it('reads value for the new key when key changes', () => {
      localStorage.setItem('key-a', JSON.stringify('value A'));
      localStorage.setItem('key-b', JSON.stringify('value B'));

      const { result, rerender } = renderHook(
        ({ key }) => usePersistedState(key, ''),
        { initialProps: { key: 'key-a' } },
      );

      expect(result.current[0]).toBe('value A');

      rerender({ key: 'key-b' });

      expect(result.current[0]).toBe('value B');
    });

    it('does not overwrite new key with stale value from previous key', () => {
      localStorage.setItem('key-a', JSON.stringify('value A'));
      localStorage.setItem('key-b', JSON.stringify('value B'));

      const { result, rerender } = renderHook(
        ({ key }) => usePersistedState(key, ''),
        { initialProps: { key: 'key-a' } },
      );

      expect(result.current[0]).toBe('value A');

      rerender({ key: 'key-b' });

      expect(result.current[0]).toBe('value B');
      expect(localStorage.getItem('key-b')).toBe(JSON.stringify('value B'));
    });

    it('returns initialValue when switching to a key with no stored value', () => {
      localStorage.setItem('key-a', JSON.stringify('value A'));

      const { result, rerender } = renderHook(
        ({ key }) => usePersistedState(key, 'default'),
        { initialProps: { key: 'key-a' } },
      );

      expect(result.current[0]).toBe('value A');

      rerender({ key: 'key-b' });

      expect(result.current[0]).toBe('default');
    });

    it('preserves value written to a key after switching away and back', () => {
      const { result, rerender } = renderHook(
        ({ key }) => usePersistedState(key, ''),
        { initialProps: { key: 'key-a' } },
      );

      act(() => {
        result.current[1]('typed in A');
      });

      rerender({ key: 'key-b' });

      act(() => {
        result.current[1]('typed in B');
      });

      rerender({ key: 'key-a' });

      expect(result.current[0]).toBe('typed in A');
      expect(localStorage.getItem('key-a')).toBe(JSON.stringify('typed in A'));
      expect(localStorage.getItem('key-b')).toBe(JSON.stringify('typed in B'));
    });
  });
});
