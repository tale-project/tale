'use client';

import { useIsMac } from './use-is-mac';

/** Modifier-key label for the global search palette (`⌘K` / `Ctrl+K`). */
export function useSearchShortcut(): string {
  const isMac = useIsMac();
  return isMac ? '⌘ K' : 'Ctrl+K';
}
