import { useEffect, useState } from 'react';

/**
 * Tracks which changelog article is currently in view for the sticky
 * timeline highlight. Uses a scroll listener (not IntersectionObserver)
 * so the "active" item is always the last release whose top has crossed
 * the sticky header offset — matches Multica/Cursor changelog behaviour.
 */
export function useActiveRelease(
  tags: readonly string[],
  /** Distance from viewport top that counts as "reached" (header + scroll-mt). */
  offsetPx = 128,
): string | null {
  const [active, setActive] = useState<string | null>(tags[0] ?? null);

  useEffect(() => {
    if (tags.length === 0) {
      setActive(null);
      return undefined;
    }

    const pick = () => {
      // Prefer an explicit hash when the user just clicked a timeline link.
      const hashTag = decodeURIComponent(
        window.location.hash.replace(/^#/, ''),
      );
      if (hashTag && tags.includes(hashTag)) {
        const el = document.getElementById(hashTag);
        if (el) {
          const top = el.getBoundingClientRect().top;
          // Only trust the hash while that article is near the offset;
          // once the user scrolls away, fall back to position.
          if (top >= -40 && top <= offsetPx + 80) {
            setActive(hashTag);
            return;
          }
        }
      }

      let current = tags[0] ?? null;
      for (const tag of tags) {
        const el = document.getElementById(tag);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= offsetPx) {
          current = tag;
        }
      }
      setActive(current);
    };

    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('hashchange', pick);
    return () => {
      window.removeEventListener('scroll', pick);
      window.removeEventListener('hashchange', pick);
    };
  }, [tags, offsetPx]);

  return active;
}
