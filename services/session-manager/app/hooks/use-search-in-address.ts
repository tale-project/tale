import { useEffect, useLayoutEffect, useRef } from 'react';

/** How long a pause in typing is, before what is typed is written to the address. */
export const SEARCH_IN_ADDRESS_DELAY_MS = 300;

interface SearchInAddressOptions {
  /** What the search box holds, and how to fill it (a list's own). */
  text: string;
  setText: (text: string) => void;
  /** What the address holds of the search ("" for nothing), and how to change it. */
  addressText: string;
  setAddressText: (text: string) => void;
  /** Off for a list that is not on a page with an address (a table in a test, a dialog). */
  enabled?: boolean;
}

/**
 * Keeps a list's search box in the address of the page, so a reload, a link and
 * the way back from another page keep the view. Both ways, with no loop:
 *
 * - What the address says, when the page opens and whenever it changes by
 *   itself (a link, the back button), is put in the box.
 * - What is typed is written to the address after a pause, once: a key a
 *   moment is not an entry of its own, and the router is not asked for every
 *   letter.
 *
 * What was last agreed on is remembered, so a write coming back from the router
 * is not mistaken for news, and what was typed meanwhile is not taken away.
 */
export function useSearchInAddress({
  text,
  setText,
  addressText,
  setAddressText,
  enabled = true,
}: SearchInAddressOptions) {
  // The list's functions are new at every render; the effects must not be.
  const setTextNow = useRef(setText);
  const setAddressNow = useRef(setAddressText);
  useLayoutEffect(() => {
    setTextNow.current = setText;
    setAddressNow.current = setAddressText;
  });

  // The text the box and the address last agreed on.
  const agreed = useRef('');

  // The box first: on opening, the address has not been put in it yet, and
  // that is not a change of the box.
  useEffect(() => {
    if (!enabled || text === agreed.current) return undefined;
    const timer = setTimeout(() => {
      agreed.current = text;
      setAddressNow.current(text);
    }, SEARCH_IN_ADDRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, text]);

  useEffect(() => {
    if (!enabled || addressText === agreed.current) return;
    agreed.current = addressText;
    setTextNow.current(addressText);
  }, [enabled, addressText]);
}
