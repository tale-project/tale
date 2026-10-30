import { expect, type Page } from '@playwright/test';
import { CLIENT_PAGE_SNAPSHOT, gotoClientPage } from '@tale/e2e/client-page';

/** Navigate like `gotoClientPage`, with the page's Markdown chunk resolving
 * after `load`. `main.tsx` renders only once the `$.tsx` loader has imported
 * that chunk, so holding its evaluation, not its fetch, makes `load` fire
 * while #root still holds the served document's own markup: the order a busy
 * CI worker produced by chance (#4536, #4554). At `load` this checks that the
 * client has not committed and the startup marker is still in place, runs
 * `atLoad` against the served markup, then releases the chunk and returns
 * `atLoad`'s result once the client commit has replaced that markup. */
export async function gotoClientPageWithLateBody<T>(
  page: Page,
  url: string,
  chunk: RegExp,
  atLoad: () => Promise<T>,
): Promise<T> {
  const gateScript = await page.addInitScript(() => {
    const gate = new Promise<void>((resolve) => {
      window.addEventListener('release-page-body', () => resolve(), {
        once: true,
      });
    });
    Object.assign(window, { testPageBodyGate: gate });
  });
  const requested = Promise.withResolvers<'requested'>();
  await page.route(
    chunk,
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      await route.fulfill({
        response,
        headers,
        body: `await window.testPageBodyGate;\n${await response.text()}`,
      });
      requested.resolve('requested');
    },
    { times: 1 },
  );
  const release = () =>
    page.evaluate(() => window.dispatchEvent(new Event('release-page-body')));

  let committed = false;
  const navigation = gotoClientPage(page, url).then(() => {
    committed = true;
  });
  try {
    // A pattern that misses the chunk lets the client commit unheld.
    const first = await Promise.race([
      requested.promise,
      navigation.then(() => 'settled' as const),
    ]);
    if (first !== 'requested') {
      throw new Error(
        `The navigation settled before the page requested ${chunk}`,
      );
    }
    // Negative control: `load` is not the client commit.
    await page.waitForLoadState('load');
    expect(committed).toBe(false);
    await expect(page.locator(CLIENT_PAGE_SNAPSHOT)).toBeAttached();
    const result = await atLoad();
    await release();
    await navigation;
    return result;
  } finally {
    // A failed step above leaves the gate shut and the navigation open.
    await release().catch((error: unknown) =>
      console.warn('Could not release the held page body', error),
    );
    await navigation.catch((error: unknown) =>
      console.warn('The held client navigation failed', error),
    );
    // Later documents of this page load their chunks unheld.
    await gateScript
      .dispose()
      .catch((error: unknown) =>
        console.warn('Could not remove the page-body gate', error),
      );
  }
}
