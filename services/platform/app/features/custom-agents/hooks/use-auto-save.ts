import { useEffect, useRef, useState, useCallback } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions<T> {
  data: T | undefined;
  onSave: (data: T) => Promise<void>;
  delay?: number;
  enabled?: boolean;
}

/**
 * Auto-saves data after a debounce delay when it changes.
 * Skips the initial value (only saves user edits).
 * Returns current save status for UI feedback.
 */
export function useAutoSave<T>({
  data,
  onSave,
  delay = 800,
  enabled = true,
}: UseAutoSaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const initializedRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const pendingRef = useRef<string | null>(null);

  const serialized = data !== undefined ? JSON.stringify(data) : undefined;

  useEffect(() => {
    if (!enabled || serialized === undefined) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSavedRef.current = serialized;
      return;
    }

    if (serialized === lastSavedRef.current) {
      pendingRef.current = null;
      return;
    }

    setStatus('saving');
    pendingRef.current = serialized;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        pendingRef.current = null;
        await onSaveRef.current(JSON.parse(serialized));
        lastSavedRef.current = serialized;
        setStatus('saved');
      } catch {
        setStatus('error');
      }
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [serialized, delay, enabled]);

  useEffect(() => {
    return () => {
      if (pendingRef.current && pendingRef.current !== lastSavedRef.current) {
        onSaveRef.current(JSON.parse(pendingRef.current)).catch(() => {});
      }
    };
  }, []);

  const reset = useCallback(() => {
    initializedRef.current = false;
    lastSavedRef.current = '';
    setStatus('idle');
  }, []);

  return { status, reset };
}
