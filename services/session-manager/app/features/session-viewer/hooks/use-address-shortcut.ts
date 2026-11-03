import { useIsMac } from '@tale/ui/use-is-mac';

/** The way out of the page to the address bar, as this computer names its keys. */
export interface AddressShortcut {
  /** What the eyes see in a badge. */
  label: string;
  /** What a screen reader says in a sentence. */
  name: string;
  /** What `aria-keyshortcuts` takes. */
  keys: string;
}

/**
 * The shortcut that leaves the page for the address bar: ⌘L on a Mac, Ctrl+L
 * elsewhere. The page has every other key while it has the keyboard, so this is
 * the one way out that the person is told about, in three spellings for three
 * readers. It follows `useSearchShortcut` (`packages/ui/src/hooks/use-search-shortcut.ts`).
 */
export function useAddressShortcut(): AddressShortcut {
  const isMac = useIsMac();
  return isMac
    ? { label: '⌘ L', name: 'Command+L', keys: 'Meta+L' }
    : { label: 'Ctrl+L', name: 'Control+L', keys: 'Control+L' };
}
