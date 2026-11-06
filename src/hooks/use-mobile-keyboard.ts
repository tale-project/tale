'use client';

import { useEffect, useState } from 'react';

interface MobileKeyboard {
  open: boolean;
  height: number | undefined;
}

const EDITABLE =
  'textarea:not([readonly]):not([disabled]), input:not([readonly]):not([disabled]), [contenteditable="true"], [contenteditable=""]';
const NON_TYPING_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'date',
  'file',
  'hidden',
  'image',
  'month',
  'radio',
  'range',
  'reset',
  'submit',
  'time',
  'week',
]);

function hasEditableFocus(): boolean {
  const element = document.activeElement;
  if (!element?.matches(EDITABLE)) return false;
  return !(
    element instanceof HTMLInputElement && NON_TYPING_INPUTS.has(element.type)
  );
}

/** Focus alone is not a software keyboard: require a substantial visual
 * viewport contraction, ignore pinch zoom, and retain the open state through
 * focus transfers until the viewport recovers. No VisualViewport means no
 * keyboard inference. */
export function useMobileKeyboard(): MobileKeyboard {
  const [state, setState] = useState<MobileKeyboard>({
    open: false,
    height: undefined,
  });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const mobile = window.matchMedia('(max-width: 767px)');
    let baseline = hasEditableFocus() ? window.innerHeight : viewport.height;
    let width = viewport.width;
    let open = false;
    const update = () => {
      if (viewport.scale !== 1) return;
      if (Math.abs(viewport.width - width) > 80) {
        baseline = window.innerHeight;
        width = viewport.width;
      }
      if (!open && !hasEditableFocus()) {
        baseline = viewport.height;
      }
      const contracted =
        baseline - viewport.height > Math.max(150, baseline * 0.2);
      open = mobile.matches && contracted && (hasEditableFocus() || open);
      const next = { open, height: open ? viewport.height : undefined };
      setState((previous) =>
        previous.open === next.open && previous.height === next.height
          ? previous
          : next,
      );
    };
    viewport.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    mobile.addEventListener('change', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      mobile.removeEventListener('change', update);
    };
  }, []);
  return state;
}
