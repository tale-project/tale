/** The host of an address (with its port), or the text itself when it is no address. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    // Not an address (about:blank has no host, a half-typed one does not parse):
    // the text is the best label there is.
    return url;
  }
}

/**
 * Who a page that speaks is: the host of its address, when it is a web page
 * (the address is not the page's to choose, as its title is), else nobody. A
 * page the browser draws itself (an error page, a blank one) names an address
 * of its own that may carry a text, and a person is not told that it is "the
 * host".
 */
export function speakerOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    const web = protocol === 'http:' || protocol === 'https:';
    return web && host !== '' ? host : null;
  } catch {
    // Not an address at all: nobody speaks.
    return null;
  }
}

/**
 * What a tab is called: its title, else the host of its address, else `untitled`
 * (a tab that has not loaded anything).
 */
export function tabLabel(
  tab: { title: string; url: string },
  untitled: string,
): string {
  if (tab.title) return tab.title;
  return tab.url ? hostOf(tab.url) : untitled;
}

/** What the address bar shows: the address of the tab being looked at, or what was just typed until its page comes. */
export function shownAddress(
  activeUrl: string | undefined,
  typed: { text: string; from: string | undefined } | null,
): string {
  if (typed !== null && typed.from === activeUrl) return typed.text;
  return activeUrl ?? '';
}
