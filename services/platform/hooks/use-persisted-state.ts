import { useEffect, useState } from 'react';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

export function setItem(key: string, value: unknown) {
  if (!isBrowser) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save to localStorage for key "${key}":`, error);
  }
}

export function getItem<T>(key: string): T | undefined {
  if (!isBrowser) return undefined;

  try {
    const item = window.localStorage.getItem(key);
    if (!item) return undefined;

    return JSON.parse(item) as T;
  } catch (error) {
    console.warn(`Failed to parse localStorage item for key "${key}":`, error);
    return undefined;
  }
}

// Safe type validator function
function isValidType<T>(value: unknown, initialValue: T): value is T {
  if (value === null || value === undefined) return false;

  // Basic type checking - if initialValue is provided, check if types match
  if (typeof initialValue === 'object' && initialValue !== null) {
    return typeof value === 'object' && value !== null;
  }

  return typeof value === typeof initialValue;
}

export function usePersistedState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    // Always return initialValue during SSR
    if (!isBrowser) return initialValue;

    const item = getItem<T>(key);

    // Validate the retrieved item against the expected type
    if (item !== undefined && isValidType(item, initialValue)) {
      return item;
    }

    return initialValue;
  });

  const [isHydrated, setIsHydrated] = useState(false);

  // Handle hydration
  useEffect(() => {
    if (!isHydrated) {
      setIsHydrated(true);

      // Re-check localStorage after hydration
      const item = getItem<T>(key);
      if (item !== undefined && isValidType(item, initialValue)) {
        setValue(item);
      }
    }
  }, [key, initialValue, isHydrated]);

  // Persist value changes
  useEffect(() => {
    if (isHydrated) {
      setItem(key, value);
    }
  }, [key, value, isHydrated]);

  return [value, setValue] as const;
}
