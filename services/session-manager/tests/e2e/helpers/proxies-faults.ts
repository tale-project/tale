import type { Page, Route } from '@playwright/test';

/*
  A backend that does not behave, for the two pages' handling of what goes wrong
  without being a refusal: a request that fails, a backend that cannot be
  reached, a page that keeps what it read while things change behind it.
*/

const isApi = (url: URL): boolean => url.pathname.startsWith('/api/');

/** What a failing backend answers: by default a 500 with a sentence of its own. */
export interface Failure {
  status: number;
  /** The code of the answer; the app has no words for the default one. */
  error: string;
  message: string;
}

const DISK_FULL: Failure = {
  status: 500,
  error: 'disk_full',
  message: 'The disk is full',
};

/**
 * Answers the requests that `match` picks with a failure (by default a 500 the
 * app has no words for, which carries a sentence of its own) until `heal()`
 * lets them through again. For the pages' own handling of what the backend
 * fails at, or refuses in a way the page did not foresee.
 */
export async function failRequests(
  page: Page,
  match: (url: URL, method: string) => boolean,
  answer: Failure = DISK_FULL,
): Promise<{ message: string; heal: () => void }> {
  let failing = true;
  await page.route(isApi, async (route) => {
    const request = route.request();
    if (failing && match(new URL(request.url()), request.method())) {
      await route.fulfill({
        status: answer.status,
        json: { error: answer.error, message: answer.message },
      });
    } else {
      await route.fallback();
    }
  });
  return {
    message: answer.message,
    heal: () => {
      failing = false;
    },
  };
}

/** The backend cannot be reached: every request to the API is cut, until `heal()`. */
export async function cutOff(
  page: Page,
): Promise<{ heal: () => Promise<void> }> {
  const cut = (route: Route) => route.abort();
  await page.route(isApi, cut);
  return { heal: () => page.unroute(isApi, cut) };
}

/**
 * Serves each GET of a list at `path` the first answer it got, again and
 * again: the page keeps what it read, however the backend changes.
 */
export async function freezeLists(page: Page, path: string): Promise<void> {
  const kept = new Map<
    string,
    { body: string; headers: Record<string, string> }
  >();
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      const known = kept.get(request.url());
      if (known !== undefined) {
        await route.fulfill({ status: 200, ...known });
        return;
      }
      const response = await route.fetch();
      const snapshot = {
        body: await response.text(),
        headers: response.headers(),
      };
      kept.set(request.url(), snapshot);
      await route.fulfill({ status: response.status(), ...snapshot });
    },
  );
}
