import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';
import { JSDOM } from 'jsdom';

import { CLIENT_PAGE_SNAPSHOT, gotoClientPage } from '../helpers/client-page';

async function documentFixture(
  page: Page,
  baseURL: string,
  initialRoot: 'prerendered' | 'empty',
) {
  const homepage = await page.request.get(baseURL);
  expect(homepage.ok()).toBe(true);
  const dom = new JSDOM(await homepage.text());
  let html: string;
  try {
    const root = dom.window.document.getElementById('root');
    if (!root) throw new Error('Homepage response has no root');
    root.innerHTML =
      initialRoot === 'prerendered'
        ? '<main><h1>Prerendered startup probe</h1></main>'
        : '';
    // Keep the real app modules and styles, served by the preview origin.
    for (const element of dom.window.document.querySelectorAll(
      'script[src], link[href]',
    )) {
      const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href';
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, new URL(value, baseURL).href);
    }
    html = dom.serialize();
  } finally {
    dom.window.close();
  }

  const compressed = gzipSync(html);
  const server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/' });
      response.end();
      return;
    }
    if (request.url !== '/') {
      // A reused local dev server can leave inline relative imports (e.g.
      // React Refresh); keep those assets on the actual app origin too.
      response.writeHead(302, {
        Location: new URL(request.url ?? '/', baseURL).href,
      });
      response.end();
      return;
    }
    response.writeHead(203, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': compressed.byteLength,
      'X-Startup-Fixture': initialRoot,
    });
    response.end(compressed);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Document fixture has no TCP address');
  }
  const url = `http://127.0.0.1:${address.port}`;
  // Only this owned fixture may load modules from the other loopback origin.
  // Ordinary app contexts retain their normal browser permission policy.
  await page.context().grantPermissions(['local-network-access'], {
    origin: url,
  });
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

for (const initialRoot of ['prerendered', 'empty'] as const) {
  test(`client navigation waits for the ${initialRoot} root to commit`, async ({
    page,
    baseURL,
  }) => {
    const fixture = await documentFixture(page, baseURL!, initialRoot);
    const requested = Promise.withResolvers<void>();
    await page.addInitScript(() => {
      const gate = new Promise<void>((resolve) => {
        window.addEventListener('release-startup-module', () => resolve(), {
          once: true,
        });
      });
      Object.assign(window, { testStartupModuleGate: gate });
    });
    await page.route(
      /\/home-page(?:-[^/]+\.js|\.tsx)(?:\?|$)/,
      async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers['content-encoding'];
        delete headers['content-length'];
        // Complete the fetch/load event, but hold actual router evaluation.
        await route.fulfill({
          response,
          headers,
          body: `await window.testStartupModuleGate;\n${await response.text()}`,
        });
        requested.resolve();
      },
    );

    let clientReady = false;
    const navigation = gotoClientPage(page, fixture.url).then((response) => {
      clientReady = true;
      return response;
    });
    try {
      await requested.promise;
      await expect(page.locator(CLIENT_PAGE_SNAPSHOT)).toBeAttached();
      // Negative control: ordinary page.goto(load) is already ready while the
      // actual initial route is still blocked and SSR locators can pass.
      await page.waitForLoadState('load');
      expect(clientReady).toBe(false);
      const probe = page.getByRole('heading', {
        name: 'Prerendered startup probe',
      });
      const previousNode =
        initialRoot === 'prerendered' ? await probe.elementHandle() : null;
      if (initialRoot === 'prerendered') {
        await expect(probe).toBeVisible();
        expect(previousNode).not.toBeNull();
      } else {
        await expect(
          page.locator('#root > :not([data-startup-snapshot])'),
        ).toHaveCount(0);
      }

      await page.evaluate(() =>
        window.dispatchEvent(new Event('release-startup-module')),
      );
      const response = await navigation;
      expect(response?.status()).toBe(203);
      expect(response?.headers()['x-startup-fixture']).toBe(initialRoot);
      expect(response?.headers()['content-encoding']).toBeUndefined();
      expect(Number(response?.headers()['content-length'])).toBe(
        Buffer.byteLength(await response!.text()),
      );
      await expect(page.locator(CLIENT_PAGE_SNAPSHOT)).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (previousNode) {
        expect(
          await previousNode.evaluate((element) => element.isConnected),
        ).toBe(false);
        await expect(previousNode.scrollIntoViewIfNeeded()).rejects.toThrow(
          'Element is not attached to the DOM',
        );
      }
    } finally {
      try {
        await page
          .evaluate(() =>
            window.dispatchEvent(new Event('release-startup-module')),
          )
          .catch(() => undefined);
        await navigation.catch(() => undefined);
      } finally {
        await fixture.close();
      }
    }
  });
}

test('client navigation preserves an HTTP redirect and refuses unmarked readiness', async ({
  page,
  baseURL,
}) => {
  const fixture = await documentFixture(page, baseURL!, 'prerendered');
  try {
    await expect(
      gotoClientPage(page, `${fixture.url}/redirect`),
    ).rejects.toThrow('HTTP redirect');
    await expect(page).toHaveURL(`${fixture.url}/`);
  } finally {
    await fixture.close();
  }
});
