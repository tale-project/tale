// Shared production-browser identity, isolation and evidence. No timed action
// or profiler lifecycle belongs here: diagnostic and acceptance own those.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { chromium, type Page } from '../../../packages/e2e/src/index.ts';
import { browserOrigins as origins } from './origins.mjs';

export interface Frame {
  tDom: number;
  tRaf: number;
  tFrame: number;
  contentFrame?: { tDom: number; tRaf: number; tFrame: number };
}
export interface Input {
  type: string;
  t: number;
  key?: string | null;
}
export interface ExpectedBoard {
  path: string;
  tasks: { title: string; assigneeName: string | null }[];
  searchValue: string;
}
export interface ExpectedGeneral {
  path: string;
  projectName: string;
}
export interface ContentFrame extends Frame {
  source: string;
  label: string;
  countFrame?: Frame;
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
    __acceptance: {
      boardState: (expected: ExpectedBoard) => boolean;
      generalState: (expected: ExpectedGeneral) => boolean;
      watchBoard: (
        expected: ExpectedBoard,
        options: { requireFalse: true },
      ) => Promise<ContentFrame>;
      watchGeneral: (
        expected: ExpectedGeneral,
        options: { requireFalse: true },
      ) => Promise<ContentFrame>;
    };
  }
}
export const cards = '[role="region"] section button.line-clamp-2';
export const viewport = { width: 1440, height: 900 };
export const browserVersion = '141.0.7390.37';

export { browserIdentity, launchBrowser } from './browser-identity.ts';

type Browser = Awaited<ReturnType<typeof chromium.launch>>;
export async function browserSession(
  browser: Browser,
  origin: string,
  ownerEmail: string,
) {
  assert(origins.includes(origin), 'Unowned browser origin');
  assert(process.env.BENCH_PASSWORD, 'Synthetic password is missing');
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
    performanceNow: performance.now(),
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
