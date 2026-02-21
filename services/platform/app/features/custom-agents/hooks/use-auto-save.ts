import { useEffect, useRef, useState, useCallback } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseAutoSaveOptions<T> {
  data: T | undefined;
  onSave: (data: T) => Promise<void>;
  delay?: number;
  enabled?: boolean;
  /**
   * 'auto' (default): debounce-saves whenever data changes.
   * 'manual': only saves when save() is called (e.g. on blur).
   */
  mode?: 'auto' | 'manual';
}

/**
 * Auto-saves data after a debounce delay when it changes.
 * Skips the initial value (only saves user edits).
 * Returns current save status for UI feedback.
 *
 * In 'manual' mode, dirty state is tracked but saves only
 * happen when save() is called explicitly (e.g. on blur)
 * or on unmount.
 */
export function useAutoSave<T>({
  data,
  onSave,
  delay = 800,
  enabled = true,
  mode = 'auto',
}: UseAutoSaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const initializedRef = useRef(false);
  const lastSavedRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const pendingRef = useRef<string | null>(null);

  const serialized = data !== undefined ? JSON.stringify(data) : undefined;
  const serializedRef = useRef(serialized);
  serializedRef.current = serialized;

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

    pendingRef.current = serialized;

    if (mode === 'manual') return;

    setStatus('saving');

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
  }, [serialized, delay, enabled, mode]);

  useEffect(() => {
    return () => {
      if (pendingRef.current && pendingRef.current !== lastSavedRef.current) {
        onSaveRef.current(JSON.parse(pendingRef.current)).catch(() => {});
      }
    };
  }, []);

  const save = useCallback(async (overrideData?: T) => {
    const dataStr =
      overrideData !== undefined
        ? JSON.stringify(overrideData)
        : serializedRef.current;

    if (!dataStr || !initializedRef.current || dataStr === lastSavedRef.current)
      return;

    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    setStatus('saving');
    try {
      await onSaveRef.current(JSON.parse(dataStr));
      lastSavedRef.current = dataStr;
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    initializedRef.current = false;
    lastSavedRef.current = '';
    setStatus('idle');
  }, []);

  return { status, reset, save };
}
