import { expect, type Page, type Route } from '@playwright/test';
import { JSDOM } from 'jsdom';

export const CLIENT_PAGE_SNAPSHOT = '[data-startup-snapshot="client-page"]';

/** Wait for the client commit, rather than acting on replaceable SSR nodes.
 * The static sites (web, docs) render with `createRoot` over prerendered HTML:
 * until the first commit replaces it, a prerendered control has no handlers,
 * and `load` does not wait for the lazy route chunk that commit awaits.
 * The document is marked through `page.route`, which cannot see a navigation
 * an active service worker serves: a suite whose site registers one (docs)
 * runs with `serviceWorkers: 'block'`. Playwright's synchronous loader cannot
 * load `jsdom` on the pinned Node 22.21.1, so a suite that imports this runs
 * through scripts that set `PLAYWRIGHT_FORCE_ASYNC_LOADER=1` (web, docs).
 * The web cold-start specs use the same hidden snapshot convention independently. */
export async function gotoClientPage(page: Page, url: string) {
  let rootMarked = false;
  let redirected = false;
  const documentRoute = async (route: Route) => {
    const request = route.request();
    if (
      !request.isNavigationRequest() ||
      request.frame() !== page.mainFrame()
    ) {
      await route.fallback();
      return;
    }

    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      redirected = true;
      await route.fulfill({ response });
      return;
    }
    if (!response.headers()['content-type']?.includes('text/html')) {
      await route.fulfill({ response });
      return;
    }

    const dom = new JSDOM(await response.text());
    try {
      const root = dom.window.document.getElementById('root');
      if (root) {
        const snapshot = dom.window.document.createElement('span');
        snapshot.hidden = true;
        snapshot.dataset.startupSnapshot = 'client-page';
        root.append(snapshot);
        rootMarked = true;
      }
      const headers = { ...response.headers() };
      // The fetched body is decoded and the sentinel changes its byte length.
      // Let Playwright describe the new body while retaining response metadata.
      delete headers['content-encoding'];
      delete headers['content-length'];
      await route.fulfill({ response, headers, body: dom.serialize() });
    } finally {
      dom.window.close();
    }
  };

  await page.route('**/*', documentRoute);
  try {
    const response = await page.goto(url);
    // Playwright routes only the first URL of an HTTP redirect. Preserve the
    // redirect, but never call its unmarked final document client-ready.
    if (redirected) {
      throw new Error('gotoClientPage requires a URL without an HTTP redirect');
    }
    expect(rootMarked, 'The initial HTML document must contain #root').toBe(
      true,
    );
    await expect(page.locator(CLIENT_PAGE_SNAPSHOT)).toHaveCount(0);
    return response;
  } finally {
    await page.unroute('**/*', documentRoute);
  }
}
