import assert from 'node:assert/strict';

import { chromium } from '../../../packages/e2e/src/index.ts';
import type { browserIdentity } from './browser-identity.ts';
import { json, outputPath } from './common.ts';
import { capturePhase as trace } from './phase.ts';

export async function traceControls(
  identity: Awaited<ReturnType<typeof browserIdentity>>,
) {
  const executable = identity.executable;
  // Functional protocol controls only: no Tale page, asset or API is warmed.
  // The ordinary pair below still launches a fresh browser for every arm.
  const control = {
    status: 'running',
    cases: [] as string[],
    browser: identity.browser,
    driverVersion: identity.driverVersion,
    browserHash: identity.browserHash,
  };
  await json('trace-control.json', control);
  const controlBrowser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  try {
    assert.equal(controlBrowser.version(), identity.browser);
    for (const name of ['static', 'navigation'] as const) {
      const context = await controlBrowser.newContext({
        serviceWorkers: 'block',
      });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await trace(cdp, outputPath(`control-${name}`), async () => {
          if (name === 'navigation')
            await page.goto(
              'data:text/html,<title>Trace control</title><main>Owned protocol control</main>',
            );
          await page.evaluate(() => {
            performance.mark('control-start');
            const element = document.createElement('span');
            element.textContent = 'protocol control';
            document.body.appendChild(element);
            performance.mark('control-end');
          });
          assert.equal(
            await page.locator('span').textContent(),
            'protocol control',
          );
          return { functionalControl: true, case: name };
        });
        control.cases.push(name);
        await json('trace-control.json', control);
      } finally {
        await context.close();
      }
    }
    control.status = 'passed';
  } catch (error) {
    control.status = 'failed';
    await json('trace-control.json', { ...control, error: String(error) });
    throw error;
  } finally {
    await controlBrowser.close();
  }
  await json('trace-control.json', control);
}
