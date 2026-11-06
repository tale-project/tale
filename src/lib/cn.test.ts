import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins simple class strings', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops nullish + falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('expands conditional objects via clsx', () => {
    expect(cn({ a: true, b: false, c: 1 })).toBe('a c');
  });

  it('flattens nested arrays', () => {
    expect(cn(['a', ['b', { c: true }], 'd'])).toBe('a b c d');
  });

  it('merges conflicting tailwind utilities (later wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm text-red-500', 'text-base')).toBe(
      'text-red-500 text-base',
    );
  });

  it('preserves non-conflicting utilities', () => {
    expect(cn('p-2 text-sm', 'bg-white')).toBe('p-2 text-sm bg-white');
  });

  it('returns an empty string when given nothing useful', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined)).toBe('');
  });

  it('handles variant arbitrary values', () => {
    expect(cn('w-[100px]', 'w-[200px]')).toBe('w-[200px]');
  });
});
