'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Gate optional expensive decoration, such as syntax highlighting, on proximity
 * to the viewport. The caller keeps the actual content in the DOM so copy,
 * browser search and assistive technology still work off screen.
 */
export function useViewportVisibility<T extends HTMLElement>(
  rootMargin = '800px',
) {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined')
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === element) setIsVisible(entry.isIntersecting);
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, isVisible };
}
