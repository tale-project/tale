import { useCallback, useEffect, useState } from 'react';

/** Shared search lifecycle for documentation articles and discovery pages.
 * Mount one controller per shell; the dialog stays mounted after its first
 * opening so its exit animation and loaded index survive later toggles. */
export function useDocsSearch() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);

  useEffect(() => {
    if (searchOpen) setSearchMounted(true);
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === 'k' || event.key === 'K')
      ) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  return { searchOpen, searchMounted, setSearchOpen, openSearch };
}
