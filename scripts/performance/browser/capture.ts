import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';

import { z } from 'zod';

import { chromium } from '../../../packages/e2e/src/index.ts';
import { proveModalFocusTrap } from './acceptance-functional.ts';
import { verifyBoot } from './boot.ts';
import {
  browserIdentity,
  browserSession,
  cards,
  fontsReady,
  observations,
  pageBoot,
  ready,
} from './browser-session.ts';
import { json, outputPath } from './common.ts';
import { latinFontContract } from './font-policy.ts';
import { browserOrigins as origins } from './origins.mjs';
import { capturePhase as trace } from './phase.ts';
import { traceControls } from './trace-controls.ts';

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
const build = z.object({
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
const builds = z
  .object({ baseline: build, candidate: build })
  .parse(JSON.parse(await readFile(outputPath('builds.json'), 'utf8')));
const identity = await browserIdentity();
const executable = identity.executable;
const rows: unknown[] = [];
const receipt = {
  driverVersion: identity.driverVersion,
  mode: 'diagnostic',
  acceptanceVerdict: 'not-evaluated',
  retries: 0,
  browser: '141.0.7390.37',
  browserHash: identity.browserHash,
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

try {
  await traceControls(identity);
  for (const [size, count] of [
    ['small', 50],
    ['large', 2000],
  ] as const) {
    for (const [index, variant] of (
      ['baseline', 'candidate'] as const
    ).entries()) {
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
        const session = await browserSession(browser, origin, ids.ownerEmail);
        const { context, page, cdp, errors } = session;
        row.errors = errors;
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
        await json('browser-receipt.json', receipt);
        const cold = await trace(
          cdp,
          outputPath(`${variant}-${size}-cold`),
          async () => {
            await page.goto(
              `${origin}/dashboard/${ids.orgId}/projects/${ids.projects[size]}/tasks/board`,
              { waitUntil: 'domcontentloaded', timeout: 120_000 },
            );
            return ready(page);
          },
          async (observed) => {
            Object.assign(row, {
              cold: observed,
              coldObservations: await observations(page),
              coldMetrics: await cdp.send('Performance.getMetrics'),
              coldCaptureComplete: false,
              phase: 'cold-observed',
            });
            await json('browser-receipt.json', receipt);
            // Inspect only the page and responses its recorded cold navigation
            // already loaded. No extra app request or cache-warming asset read.
            const evidence = await pageBoot(session);
            row.coldBoot = evidence;
            await json('browser-receipt.json', receipt);
            verifyBoot(evidence, origin, builds[variant].assets);
            assert.deepEqual(
              errors,
              [],
              'Cold browser errors invalidate this sample',
            );
          },
        );
        Object.assign(row, {
          cold,
          coldCaptureComplete: true,
          phase: 'cold-complete',
        });
        await json('browser-receipt.json', receipt);
        await fontsReady(
          session,
          {
            ...latinFontContract(origin, builds[variant].assets),
            requiredWeights: [500],
          },
          async (evidence) => {
            row.fonts = evidence;
            await json('browser-receipt.json', receipt);
          },
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
        const open = await trace(
          cdp,
          outputPath(`${variant}-${size}-open`),
          async () => {
            await card.click({ timeout: 120_000 });
            return ready(page);
          },
          async (observed) => {
            Object.assign(row, {
              open: observed,
              openObservations: await observations(page),
              openMetrics: await cdp.send('Performance.getMetrics'),
              openCaptureComplete: false,
              phase: 'open-observed',
            });
            await json('browser-receipt.json', receipt);
          },
        );
        const dialog = page.getByRole('dialog', { name: title, exact: true });
        Object.assign(row, {
          open,
          openCaptureComplete: true,
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
        // Reuse the same actual forward/backward focus walk, outside timing.
        row.phase = 'focus-wrap';
        await json('browser-receipt.json', receipt);
        row.focusTrap = await proveModalFocusTrap(
          page,
          title,
          120_000,
          (value) => {
            row.focusTrap = value;
          },
        );
        await json('browser-receipt.json', receipt);
        await page.screenshot({
          path: outputPath(`${variant}-${size}-dialog.png`),
        });
        await page.evaluate((taskTitle) => {
          window.__perf.inputs = [];
          window.__benchmarkReady = window.__perf.watchDialog(taskTitle, false);
        }, title);
        Object.assign(row, { closeStartedAt: Date.now(), phase: 'close' });
        await json('browser-receipt.json', receipt);
        const close = await trace(
          cdp,
          outputPath(`${variant}-${size}-close`),
          async () => {
            await page.keyboard.press('Escape');
            return ready(page);
          },
          async (observed) => {
            Object.assign(row, {
              close: observed,
              closeObservations: await observations(page),
              closeCaptureComplete: false,
              phase: 'close-observed',
            });
            await json('browser-receipt.json', receipt);
          },
        );
        Object.assign(row, {
          close,
          closeCaptureComplete: true,
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
