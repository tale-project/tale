import { useCallback, useEffect, useRef } from 'react';

/**
 * Whether focus is somewhere nobody put it: on the page itself, or on a
 * container around `region` — where a dialog's focus trap parks focus once
 * the element that held it is removed. Focus on any other element is a
 * place the member chose (a tree row, the close button, a field).
 */
function isFocusStranded(region: Element | null): boolean {
  const active = document.activeElement;
  if (
    active === null ||
    active === document.body ||
    active === document.documentElement
  ) {
    return true;
  }
  return region !== null && active !== region && active.contains(region);
}

/**
 * The recovery rule for Try again on a failed read. Try again on a failed
 * first read puts the pane back under its loading mask, which takes the
 * control, and the focus on it, away; the next failure renders a new
 * control. `arm` runs from the control's own handler and remembers whether
 * focus was inside `ref`. When the read is `failed` again, focus goes to the
 * new control only if it is still stranded (`isFocusStranded`): a member who
 * moved focus somewhere while the retry ran keeps it there. An answer, or
 * another read (`key`: the resource the host now shows), disarms it, so
 * a failure the member did not retry never moves their focus.
 */
export function useRetryFocus(
  status: 'loading' | 'failed' | 'ready',
  key?: string,
) {
  const ref = useRef<HTMLDivElement>(null);
  const armed = useRef(false);

  useEffect(() => {
    armed.current = false;
  }, [key]);

  useEffect(() => {
    if (status === 'ready') {
      armed.current = false;
      return;
    }
    if (status !== 'failed' || !armed.current) return;
    armed.current = false;
    if (isFocusStranded(ref.current)) {
      ref.current?.querySelector('button')?.focus();
    }
  }, [status]);

  const arm = useCallback(() => {
    armed.current = ref.current?.contains(document.activeElement) ?? false;
  }, []);

  return { ref, arm };
}
