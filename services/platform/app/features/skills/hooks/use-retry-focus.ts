import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps keyboard focus on Try again when a retry fails again. Try again on
 * a failed first read puts the pane back under its loading mask, which
 * takes the control, and the focus on it, away; the next failure renders a
 * new control. `arm` runs from the control's own handler and remembers
 * whether focus was inside `ref`; when the read is `failed` again, focus
 * goes to the new control. An answer disarms it, so a later failure the
 * member did not ask about never moves their focus.
 */
export function useRetryFocus(status: 'loading' | 'failed' | 'ready') {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (status === 'ready') {
      armed.current = false;
      return;
    }
    if (status !== 'failed' || !armed.current) return;
    armed.current = false;
    ref.current?.querySelector('button')?.focus();
  }, [status]);

  const arm = useCallback(() => {
    armed.current = ref.current?.contains(document.activeElement) ?? false;
  }, []);

  return { ref, arm };
}
