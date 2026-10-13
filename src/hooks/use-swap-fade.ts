'use client';

import { useLayoutEffect, useRef } from 'react';

const SWAP_KEYFRAMES: Keyframe[] = [{ opacity: 0.35 }, { opacity: 1 }];
const SWAP_TIMING: KeyframeAnimationOptions = {
  duration: 240,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};

/** Not yet rendered once — the mount itself never fades. */
const UNSET = Symbol('unset');

/**
 * A soft fade whenever a view shows another item in the same place — the
 * next chat, task or conversation opening where the last one stood — so
 * the swap reads as a change of content rather than a flicker.
 *
 * Opacity only: a transform would move every rect the view measures while
 * it settles (a transcript restoring its scroll, a composer sizing itself).
 * The node stays mounted and the Web Animations API plays the fade, so a
 * view that keeps state across items keeps it. The first render never
 * fades; neither does a change to "nothing open".
 */
export function useSwapFade<T extends HTMLElement>(
  itemKey: string | undefined,
  options: {
    /** Fade when an item opens where nothing was — off for a view whose
     * first item is born in place (a chat created by its first message). */
    fromEmpty?: boolean;
  } = {},
) {
  const { fromEmpty = true } = options;
  const ref = useRef<T>(null);
  const previous = useRef<string | undefined | typeof UNSET>(UNSET);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = itemKey;
    if (before === UNSET || itemKey === undefined || before === itemKey) {
      return undefined;
    }
    if (before === undefined && !fromEmpty) return undefined;
    const node = ref.current;
    if (node === null || typeof node.animate !== 'function') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const animation = node.animate(SWAP_KEYFRAMES, SWAP_TIMING);
    return () => animation.cancel();
  }, [itemKey, fromEmpty]);

  return ref;
}
