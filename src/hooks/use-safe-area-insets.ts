import { useEffect, useState } from 'react';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

type InsetSide = 'top' | 'right' | 'bottom' | 'left';

function readInset(side: InsetSide): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  // Set only the side-specific padding so we can read it back cleanly. Using
  // a single padding shorthand and then re-reading paddingTop returned the
  // top inset for every side — a bug caught by CodeRabbit review.
  probe.style.setProperty(`padding-${side}`, `env(safe-area-inset-${side})`);
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe);
  const value = parseFloat(computed.getPropertyValue(`padding-${side}`)) || 0;
  document.body.removeChild(probe);
  return value;
}

/**
 * Returns the current `env(safe-area-inset-*)` values in pixels. Reads once
 * on mount and again on `resize` / `orientationchange`. Returns zeros until
 * the first effect runs, so server and first-render are stable.
 */
export function useSafeAreaInsets(): SafeAreaInsets {
  const [insets, setInsets] = useState(ZERO);

  useEffect(() => {
    const read = () => {
      setInsets({
        top: readInset('top'),
        right: readInset('right'),
        bottom: readInset('bottom'),
        left: readInset('left'),
      });
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, []);

  return insets;
}
