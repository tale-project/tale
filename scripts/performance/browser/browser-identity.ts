import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { z } from 'zod';

import { chromium } from '../../../packages/e2e/src/index.ts';

export async function browserIdentity() {
  const executable = process.env.BENCH_CHROMIUM;
  assert(executable, 'Pinned browser executable is missing');
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
    browser: '141.0.7390.37',
    browserHash: createHash('sha256')
      .update(await readFile(executable))
      .digest('hex'),
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
