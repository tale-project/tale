import { useCallback, useEffect, useRef, useState } from 'react';

const isBrowser = typeof window !== 'undefined';

function setItem(key: string, value: unknown) {
  if (!isBrowser) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save to localStorage for key "${key}":`, error);
  }
}

function getItem<T>(key: string): T | undefined {
  if (!isBrowser) return undefined;

  try {
    const item = window.localStorage.getItem(key);
    if (!item) return undefined;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns any; validated by isValidType() before use
    return JSON.parse(item) as T;
  } catch (error) {
    console.warn(`Failed to parse localStorage item for key "${key}":`, error);
    return undefined;
  }
}

function isValidType<T>(value: unknown, initialValue: T): value is T {
  if (value === null || value === undefined) return false;

  if (typeof initialValue === 'object' && initialValue !== null) {
    return typeof value === 'object' && value !== null;
  }

  return typeof value === typeof initialValue;
}

export function usePersistedState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);
  const prevKeyRef = useRef(key);
  const clearedRef = useRef(false);

  // On mount: hydrate from localStorage
  useEffect(() => {
    setIsHydrated(true);

    const item = getItem<T>(key);
    if (item !== undefined && isValidType(item, initialValue)) {
      setValue(item);
    }
    // Only runs on mount (key/initialValue are stable on first render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On key change: read the new key's value synchronously during render
  // so the persist effect sees the correct value
  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key;

    const item = getItem<T>(key);
    if (item !== undefined && isValidType(item, initialValue)) {
      setValue(item);
    } else {
      setValue(initialValue);
    }
  }

  // Persist value changes to localStorage
  useEffect(() => {
    if (!isHydrated) return;
    if (clearedRef.current) {
      clearedRef.current = false;
      return;
    }
    setItem(key, value);
  }, [key, value, isHydrated]);

  const clear = useCallback(() => {
    clearedRef.current = true;
    setValue(initialValue);
    if (isBrowser) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        console.warn(`Failed to remove localStorage key "${key}":`, error);
      }
    }
  }, [key, initialValue]);

  return [value, setValue, clear] as const;
}
