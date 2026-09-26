import { useEffect } from 'react';

/** One mounted component's text for the browser tab. */
interface Claim {
  title: string;
  notice: boolean;
}

/** Mount order — the latest claim is the one the tab shows, a notice first. */
const claims: Claim[] = [];
/** The page's own title — the route `head`'s — handed back when no claim is left. */
let pageTitle = '';
/** The title this module last put up, to tell its own writes from the head's. */
let shown: string | undefined;
let headWatcher: MutationObserver | null = null;

function show() {
  const top = claims.findLast((entry) => entry.notice) ?? claims.at(-1);
  if (top === undefined) return;
  shown = top.title;
  if (document.title !== top.title) document.title = top.title;
}

/** The route `head` replaced the title underneath — a navigation, or the org
 * name arriving. That is the page's own title from now on; the claim goes
 * back over it. */
function onHeadChange() {
  if (document.title === shown) return;
  pageTitle = document.title;
  show();
}

function claim(title: string, notice: boolean): Claim {
  const own = { title, notice };
  if (claims.length === 0) {
    pageTitle = document.title;
    headWatcher = new MutationObserver(onHeadChange);
    headWatcher.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  claims.push(own);
  show();
  return own;
}

function release(own: Claim) {
  const index = claims.indexOf(own);
  if (index !== -1) claims.splice(index, 1);
  if (claims.length > 0) {
    show();
    return;
  }
  headWatcher?.disconnect();
  headWatcher = null;
  // The navigation that unmounts this page may already have put the next
  // page's title up; only a title this module wrote is handed back.
  if (document.title === shown) document.title = pageTitle;
  shown = undefined;
}

/**
 * Names the browser tab while mounted — the open chat or task rather than its
 * section — and hands the page's own title back on unmount. The latest
 * mounted title shows; a `notice` about the app itself (it is offline)
 * outranks the names of the pages beneath it. The route `head` keeps owning
 * the `<title>` element and replaces it whenever the page's title changes, so
 * the title is put back over each replacement. `undefined` is a no-op.
 */
export function useDocumentTitle(
  title: string | undefined,
  { notice = false }: { notice?: boolean } = {},
): void {
  useEffect(() => {
    if (title === undefined) return undefined;
    const own = claim(title, notice);
    return () => release(own);
  }, [title, notice]);
}
