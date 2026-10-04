import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadavg } from 'node:os';

import { z } from 'zod';

import {
  chromium,
  type CDPSession,
  type Page,
} from '../../../packages/e2e/src/index.ts';
import { json, outputPath } from './common.ts';
import { finishProfile, saveRawTrace } from './trace.ts';

interface Frame {
  tDom: number;
  tRaf: number;
  tFrame: number;
}
interface Input {
  type: string;
  t: number;
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

const ids = z
  .object({
    orgId: z.string(),
    ownerEmail: z.string(),
    projects: z.object({ small: z.string(), large: z.string() }),
  })
  .parse(JSON.parse(await readFile(outputPath('seed-ids.json'), 'utf8')));
const targetSchema = z.object({ taskId: z.string(), title: z.string() });
const fixture = z
  .object({
    small: z.object({ target: targetSchema }),
    large: z.object({ target: targetSchema }),
  })
  .parse(JSON.parse(await readFile(outputPath('seed-summary.json'), 'utf8')));
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
const driverOwner = z
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
  driverOwner.dependencies['@playwright/test'],
  'Browser driver differs from the E2E package pin',
);
const browserHash = createHash('sha256')
  .update(await readFile(executable))
  .digest('hex');
const origins = ['http://127.0.0.1:43830', 'http://127.0.0.1:43831'];
const cards = '[role="region"] section button.line-clamp-2';
const rows: unknown[] = [];
const receipt = {
  driverVersion: driver.version,
  mode: 'diagnostic',
  acceptanceVerdict: 'not-evaluated',
  retries: 0,
  browser: '141.0.7390.37',
  browserHash,
  viewport: { width: 1440, height: 900 },
  order: ['baseline', 'candidate'],
  sizes: [50, 2000],
  rows,
  forcedGc:
    'One explicit collectGarbage before each dialog open, outside its trace, as identical preconditioning. All natural GC within traces is retained; no samples or events are excluded.',
  coldOrigin:
    'tDom/tRaf/tFrame are milliseconds from navigation performance.timeOrigin; cold is not an input-latency metric.',
  queryObservers: {
    available: false,
    reason:
      'The production build exposes no supported query-client inspection surface. No observer count is inferred from DOM or heap.',
  },
  limits:
    'One serial pair per size on a fresh Linux host. Both arms share one unchanged API and database. Task detail reads are identically prewarmed for dialog measurements. Fixed-order backend warming remains a limitation. Content-ready rendering opportunities are not first-visible-pixel proof. Original latency criteria remain unchanged.',
};

async function trace<T>(
  cdp: CDPSession,
  name: string,
  action: () => Promise<T>,
) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking',
    transferMode: 'ReturnAsStream',
  });
  try {
    return await action();
  } catch (error) {
    await json(`${name}.action-failure.json`, { error: String(error) });
    throw error;
  } finally {
    const retained = await Promise.allSettled([
      finishProfile(cdp, outputPath(`${name}.cpuprofile`)),
      saveRawTrace(cdp, outputPath(`${name}.trace.json`)),
    ]);
    await json(
      `${name}.capture.json`,
      retained.map((result) =>
        result.status === 'fulfilled'
          ? { status: 'complete', ...result.value }
          : { status: 'incomplete', error: String(result.reason) },
      ),
    );
    assert(
      retained.every((result) => result.status === 'fulfilled'),
      'Profile or trace retention failed; partial evidence retained',
    );
  }
}

async function observations(page: Page) {
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

async function ready(page: Page) {
  return page.evaluate(() =>
    Promise.race([
      window.__benchmarkReady,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Content readiness timed out')),
          120_000,
        ),
      ),
    ]),
  );
}

try {
  for (const [size, count] of [
    ['small', 50],
    ['large', 2000],
  ] as const) {
    for (const [index, variant] of ['baseline', 'candidate'].entries()) {
      const origin = origins[index]!;
      const row: Record<string, unknown> = {
        variant,
        size: count,
        startedAt: Date.now(),
        complete: false,
        phase: 'launch',
        loadBefore: loadavg(),
      };
      rows.push(row);
      await json('browser-receipt.json', receipt);
      assert(loadavg()[0] < 2.5, 'Fixed host load gate refused the sample');
      const browser = await chromium.launch({
        executablePath: executable,
        headless: true,
        args: ['--enable-precise-memory-info'],
      });
      try {
        assert.equal(
          browser.version(),
          receipt.browser,
          'Wrong historical browser binary',
        );
        const context = await browser.newContext({
          viewport: receipt.viewport,
          deviceScaleFactor: 1,
          serviceWorkers: 'block',
          locale: 'en-US',
          timezoneId: 'UTC',
        });
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
            data: {
              email: ids.ownerEmail,
              password: process.env.BENCH_PASSWORD,
            },
            timeout: 30_000,
          },
        );
        assert(login.ok(), 'Synthetic sign-in failed');
        const page = await context.newPage();
        const errors: string[] = [];
        row.errors = errors;
        page.on('console', (message) => {
          if (message.type() === 'error')
            errors.push(
              `console error: ${message.text().replaceAll(process.env.BENCH_PASSWORD!, '[redacted]')}`,
            );
        });
        page.on('response', (response) => {
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
        await page.addInitScript(
          ({ selector, total }) => {
            addEventListener('DOMContentLoaded', () => {
              window.__benchmarkReady = window.__perf.watch(
                selector,
                (n) => n === total,
                'cold-board',
              );
            });
          },
          { selector: cards, total: count },
        );
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        await json('browser-receipt.json', receipt);
        const cold = await trace(cdp, `${variant}-${size}-cold`, async () => {
          await page.goto(
            `${origin}/dashboard/${ids.orgId}/projects/${ids.projects[size]}/tasks/board`,
            { waitUntil: 'domcontentloaded', timeout: 120_000 },
          );
          return ready(page);
        });
        Object.assign(row, {
          cold,
          coldObservations: await observations(page),
          coldMetrics: await cdp.send('Performance.getMetrics'),
          phase: 'cold-complete',
        });
        await json('browser-receipt.json', receipt);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(
            () =>
              [...document.fonts].filter((font) => font.status === 'error')
                .length,
          ),
          0,
          'A font failed to load',
        );
        await page.waitForTimeout(3000);
        const { taskId, title } = fixture[size].target;
        const card = page
          .locator(cards)
          .and(page.getByRole('button', { name: title, exact: true }));
        assert.equal(await card.count(), 1, 'Synthetic target is not unique');
        const prewarm = await context.request.get(
          `${origin}/api/app/tasks/${encodeURIComponent(taskId)}?orgId=${encodeURIComponent(ids.orgId)}`,
        );
        assert(prewarm.ok(), 'Task detail prewarm failed');
        assert.equal((await prewarm.json()).task.id, taskId);
        await cdp.send('HeapProfiler.collectGarbage');
        await page.waitForTimeout(1000);
        const metricsBefore = await cdp.send('Performance.getMetrics');
        Object.assign(row, {
          taskId,
          metricsBefore,
          beforeOpen: await observations(page),
          openStartedAt: Date.now(),
          phase: 'open',
        });
        await json('browser-receipt.json', receipt);
        await page.evaluate((taskTitle) => {
          window.__perf.inputs = [];
          window.__benchmarkReady = window.__perf.watchDialog(taskTitle, true);
        }, title);
        const open = await trace(cdp, `${variant}-${size}-open`, async () => {
          await card.click({ timeout: 120_000 });
          return ready(page);
        });
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        Object.assign(row, {
          open,
          openObservations: await observations(page),
          openMetrics: await cdp.send('Performance.getMetrics'),
          phase: 'open-complete',
        });
        await json('browser-receipt.json', receipt);
        const inputs = await page.evaluate(() => window.__perf.inputs);
        const click = inputs.find((input) => input.type === 'click');
        assert(click, 'Open input timestamp was not captured');
        assert(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          'Dialog did not own focus',
        );
        // Outside the timed open/close windows, walk the actual browser tab
        // order until it wraps. One Tab from initial focus cannot prove a trap.
        const focusTrap = {
          forwardSteps: 0,
          forwardWrapped: false,
          backwardWrapped: false,
        };
        row.focusTrap = focusTrap;
        row.phase = 'focus-wrap';
        await json('browser-receipt.json', receipt);
        await page.keyboard.press('Tab');
        assert(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          'Initial Tab escaped the modal',
        );
        const first = await page.evaluateHandle(() => document.activeElement);
        let last = first;
        try {
          for (let step = 0; step < 128; step += 1) {
            await page.keyboard.press('Tab');
            focusTrap.forwardSteps += 1;
            assert(
              await dialog.evaluate((element) =>
                element.contains(document.activeElement),
              ),
              'Forward Tab escaped the modal',
            );
            if (
              await first.evaluate(
                (element) => element === document.activeElement,
              )
            ) {
              focusTrap.forwardWrapped = true;
              break;
            }
            if (last !== first) await last.dispose();
            last = await page.evaluateHandle(() => document.activeElement);
          }
          assert(
            focusTrap.forwardWrapped,
            'Modal tab order did not wrap within the declared 128-step bound',
          );
          assert(
            focusTrap.forwardSteps > 1,
            'The synthetic task modal must expose more than one reachable control',
          );
          await page.keyboard.press('Shift+Tab');
          focusTrap.backwardWrapped = await last.evaluate(
            (element) => element === document.activeElement,
          );
          assert(
            focusTrap.backwardWrapped,
            'Backward Tab did not wrap from first to last',
          );
          assert(
            await dialog.evaluate((element) =>
              element.contains(document.activeElement),
            ),
            'Backward Tab escaped the modal',
          );
          await json('browser-receipt.json', receipt);
        } finally {
          if (last !== first) await last.dispose();
          await first.dispose();
        }
        await page.screenshot({
          path: outputPath(`${variant}-${size}-dialog.png`),
        });
        await page.evaluate((taskTitle) => {
          window.__perf.inputs = [];
          window.__benchmarkReady = window.__perf.watchDialog(taskTitle, false);
        }, title);
        Object.assign(row, { closeStartedAt: Date.now(), phase: 'close' });
        await json('browser-receipt.json', receipt);
        const close = await trace(cdp, `${variant}-${size}-close`, async () => {
          await page.keyboard.press('Escape');
          return ready(page);
        });
        Object.assign(row, {
          close,
          closeObservations: await observations(page),
          phase: 'close-complete',
        });
        await json('browser-receipt.json', receipt);
        assert(
          await card.evaluate((element) => element === document.activeElement),
          'Escape did not restore the opener',
        );
        const closeInputs = await page.evaluate(() => window.__perf.inputs);
        const escape = closeInputs.find((input) => input.type === 'keydown');
        assert(escape, 'Close input timestamp was not captured');
        assert.deepEqual(errors, [], 'Browser errors invalidate this sample');
        const metricsAfter = await cdp.send('Performance.getMetrics');
        const loadAfter = loadavg();
        Object.assign(row, {
          inputToOpenFrameMs: open.tFrame - click.t,
          inputToCloseFrameMs: close.tFrame - escape.t,
          metricsAfter,
          errors,
          loadAfter,
          complete: true,
          phase: 'complete',
          finishedAt: Date.now(),
          invalid: loadAfter[0] >= 2.5,
        });
        await json('browser-receipt.json', receipt);
        assert(
          loadAfter[0] < 2.5,
          'Host exceeded the fixed load limit; sample retained as invalid',
        );
      } finally {
        await browser.close();
      }
    }
  }
} catch (error) {
  await json('browser-failure.json', { ...receipt, error: String(error) });
  throw error;
}
