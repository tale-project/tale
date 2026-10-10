'use client';

import { useEffect, useRef } from 'react';

export function useImeComposition(active = true) {
  const composingTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (!active) composingTargetRef.current = null;
  }, [active]);

  const endComposition = () => {
    composingTargetRef.current = null;
  };

  return {
    isComposing: (event?: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>) =>
      (composingTargetRef.current instanceof Node &&
        composingTargetRef.current.isConnected) ||
      event?.isComposing === true ||
      event?.keyCode === 229,
    compositionProps: {
      onCompositionStart: (event: { target: EventTarget | null }) => {
        composingTargetRef.current = event.target;
      },
      onCompositionEnd: endComposition,
      onBlur: endComposition,
    },
  };
}
