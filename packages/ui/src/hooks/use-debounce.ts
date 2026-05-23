import { useEffect, useState } from 'react';

/**
 * Returns a value that updates `delay` ms after `value` last changed.
 * Lifted from `services/platform/app/hooks/use-debounce.ts` so the docs
 * search dialog can reuse the same shape without taking a dep on platform.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}
