// Shared production-browser identity, isolation and evidence. No timed action
// or profiler lifecycle belongs here: diagnostic and acceptance own those.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { z } from 'zod';

import { chromium, type Page } from '../../../packages/e2e/src/index.ts';
import { browserOrigins as origins } from './origins.mjs';

export interface Frame {
  tDom: number;
  tRaf: number;
  tFrame: number;
}
export interface Input {
  type: string;
  t: number;
  key?: string | null;
}
declare global {
  interface Window {
    __perf: {
      inputs: Input[];
      longtasks: number[][];
      events: unknown[];
      lcp: number[];
      watch: (
        selector: string,
        predicate: (count: number) => boolean,
        label: string,
      ) => Promise<Frame>;
      watchDialog: (title: string, open: boolean) => Promise<Frame>;
    };
    __benchmarkReady: Promise<Frame>;
  }
}
export const cards = '[role="region"] section button.line-clamp-2';
export const viewport = { width: 1440, height: 900 };
export const browserVersion = '141.0.7390.37';

export async function browserIdentity() {
  const executable = process.env.BENCH_CHROMIUM;
  assert(
    executable && process.env.BENCH_PASSWORD,
    'Synthetic browser environment is missing',
  );
  const driverRequire = createRequire(
    new URL('../../../packages/e2e/package.json', import.meta.url),
  );
  const driver = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(
        await readFile(
          driverRequire.resolve('@playwright/test/package.json'),
          'utf8',
        ),
      ),
    );
  const owner = z
    .object({ dependencies: z.object({ '@playwright/test': z.string() }) })
    .parse(
      JSON.parse(
        await readFile(
          new URL('../../../packages/e2e/package.json', import.meta.url),
          'utf8',
        ),
      ),
    );
  assert.equal(
    driver.version,
    owner.dependencies['@playwright/test'],
    'Browser driver differs from the E2E package pin',
  );
  return {
    executable,
    driverVersion: driver.version,
    browser: browserVersion,
    browserHash: createHash('sha256')
      .update(await readFile(executable))
      .digest('hex'),
    viewport,
  };
}

export async function launchBrowser(
  identity: Awaited<ReturnType<typeof browserIdentity>>,
) {
  const browser = await chromium.launch({
    executablePath: identity.executable,
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  try {
    assert.equal(
      browser.version(),
      identity.browser,
      'Wrong historical browser binary',
    );
    return browser;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

type Browser = Awaited<ReturnType<typeof chromium.launch>>;
export async function browserSession(
  browser: Browser,
  origin: string,
  ownerEmail: string,
) {
  assert(origins.includes(origin), 'Unowned browser origin');
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  try {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return origins.includes(url.origin) || url.protocol === 'data:'
        ? route.continue()
        : route.abort();
    });
    const login = await context.request.post(
      `${origin}/api/auth/sign-in/email`,
      {
        headers: { origin },
        data: { email: ownerEmail, password: process.env.BENCH_PASSWORD },
        timeout: 30_000,
      },
    );
    assert(login.ok(), 'Synthetic sign-in failed');
    const page = await context.newPage();
    const scriptResponses = new Map<
      string,
      Awaited<ReturnType<Page['waitForResponse']>>
    >();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error')
        errors.push(
          `console error: ${message.text().replaceAll(process.env.BENCH_PASSWORD!, '[redacted]')}`,
        );
    });
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script')
        scriptResponses.set(response.url(), response);
      if (response.status() >= 400)
        errors.push(
          `HTTP ${response.status()}: ${new URL(response.url()).pathname}`,
        );
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) =>
      errors.push(`request failed: ${new URL(request.url()).pathname}`),
    );
    await page.addInitScript({
      path: new URL('./observer.js', import.meta.url).pathname,
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    return { context, page, cdp, errors, scriptResponses };
  } catch (error) {
    await context.close();
    throw error;
  }
}
export type BrowserSession = Awaited<ReturnType<typeof browserSession>>;

export async function observations(page: Page) {
  return page.evaluate(() => ({
    at: Date.now(),
    timeOrigin: performance.timeOrigin,
    domElements: document.getElementsByTagName('*').length,
    longtasks: window.__perf.longtasks,
    events: window.__perf.events,
    lcp: window.__perf.lcp,
    inputs: window.__perf.inputs,
    marks: performance
      .getEntriesByType('mark')
      .map((entry) => ({ name: entry.name, at: entry.startTime })),
  }));
}

export async function ready(page: Page, timeoutMs = 120_000) {
  return page.evaluate(async (timeout) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        window.__benchmarkReady,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Content readiness timed out')),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, timeoutMs);
}

export async function pageBoot(session: BrowserSession) {
  const boot = await session.page.evaluate(() => ({
    origin: location.origin,
    siteUrl: (window as unknown as { __ENV__?: { SITE_URL?: unknown } }).__ENV__
      ?.SITE_URL,
    figmaScripts: [...document.scripts]
      .map((script) => script.src)
      .filter((src) => src && new URL(src).hostname === 'mcp.figma.com'),
    modules: [
      ...document.querySelectorAll<HTMLScriptElement>(
        'script[type="module"][src]',
      ),
    ].map((script) => script.src),
  }));
  const entries = [];
  for (const url of boot.modules) {
    const response = session.scriptResponses.get(url);
    if (response)
      entries.push({
        url,
        sha256: createHash('sha256')
          .update(await response.body())
          .digest('hex'),
      });
  }
  const evidence = { ...boot, entries };
  return evidence;
}

export async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(
      () =>
        [...document.fonts].filter((font) => font.status === 'error').length,
    ),
    0,
    'A font failed to load',
  );
}
