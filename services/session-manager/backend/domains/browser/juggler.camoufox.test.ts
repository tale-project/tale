// The real thing: the Camoufox build that camoufox-js installs is one whose
// waits `juggler.ts` knows how to change, and once changed, a mouse event that
// a page never answers does not stop the mouse. Opt in with
// `bun run test:camoufox` (a build installed in `CAMOUFOX_INSTALL_DIR`, which
// the second test changes as the app would).
//
// A tab moves to another process when it opens or leaves a page that sends
// Cross-Origin-Opener-Policy, as google.com does; a mouse event sent at that
// moment is never answered. The build as it came stopped taking the mouse at
// the first such event (every later one waited behind it until the tab closed).

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import { firefox } from 'playwright-core';
import type { BrowserContext } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { isInstalled } from './install.ts';
import {
  ANSWER_WAIT_MS,
  EDITS,
  MARKER,
  TABS_MARKER,
  boundInputWaits,
  openPagesInTabs,
} from './juggler.ts';

const ready = process.env.CAMOUFOX_INSTALL_DIR !== undefined && isInstalled();

/** Longer than any mouse event takes in a changed build, even one that is never answered. */
const STOPPED_MS = 4 * ANSWER_WAIT_MS;

const directories: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function installedOmniJa(): Promise<string> {
  const { getPath } = await import('camoufox-js/dist/pkgman.js');
  return getPath('omni.ja');
}

describe.skipIf(!ready)('the waits of the installed build', () => {
  it('are ones the app knows how to change', async () => {
    const installed = await installedOmniJa();
    // As camoufox-js installed it: the app may have changed it already.
    const original = existsSync(`${installed}.orig`)
      ? `${installed}.orig`
      : installed;
    const dir = tempDir('sm-juggler-');
    const omniJa = join(dir, 'omni.ja');
    copyFileSync(original, omniJa);

    const outcome = await boundInputWaits(omniJa);
    expect(
      outcome,
      'a build that bounds the waits itself ("bounded") needs juggler.ts no more; for any other answer, write its changes anew',
    ).toBe('changed');
    const zip = new AdmZip(omniJa);
    for (const name of Object.keys(EDITS)) {
      expect(zip.getEntry(name)?.getData().toString('utf8')).toContain(MARKER);
    }
  });

  it('have a newPage the app knows how to make open tabs', async () => {
    const installed = await installedOmniJa();
    const original = existsSync(`${installed}.orig`)
      ? `${installed}.orig`
      : installed;
    const dir = tempDir('sm-juggler-');
    const omniJa = join(dir, 'omni.ja');
    copyFileSync(original, omniJa);

    expect(
      await openPagesInTabs(omniJa),
      'newPage of this build is not the one juggler.ts changes: write TABS_EDIT anew',
    ).toBe('changed');
    const registry = new AdmZip(omniJa)
      .getEntry('chrome/juggler/content/TargetRegistry.js')
      ?.getData()
      .toString('utf8');
    expect(registry).toContain(TABS_MARKER);
  });
});

describe.skipIf(!ready)('a changed build', () => {
  let server: Server;
  let port: number;
  let context: BrowserContext;

  beforeAll(async () => {
    expect(await boundInputWaits(await installedOmniJa())).not.toBe('unknown');
    // Two sites on this host: 127.0.0.1, and localhost with
    // Cross-Origin-Opener-Policy, which Firefox gives a process of its own.
    server = createServer((request, response) => {
      const isolated = (request.url ?? '').startsWith('/isolated');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        ...(isolated ? { 'cross-origin-opener-policy': 'same-origin' } : {}),
      });
      response.end(
        `<!doctype html><title>${isolated ? 'isolated' : 'plain'}</title>` +
          '<body style="margin:0;height:3000px" ' +
          'onclick="document.title = \'clicked\'">a page</body>',
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('no port');
    }
    port = address.port;
    const { launchOptions } = await import('camoufox-js');
    const options = await launchOptions({
      headless: true,
      os: 'windows',
      geoip: false,
      locale: 'en-US',
      // Downloaded when it is missing, and the lane has no network.
      exclude_addons: ['UBO'],
    });
    context = await firefox.launchPersistentContext(
      tempDir('sm-juggler-browser-'),
      { ...options, viewport: null },
    );
  }, 600_000);

  afterAll(async () => {
    await context?.close();
    await new Promise<void>((done) => server?.close(() => done()));
  });

  it('keeps taking the mouse when an event reaches a tab that moves to another process', async () => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`http://127.0.0.1:${port}/plain`);

    /** Moves the pointer on while the tab goes there, as a hand does; the move that was not done in time, if one was not. */
    async function moveWhileGoingTo(target: string): Promise<string | null> {
      const navigation = page.goto(target);
      for (let i = 0; i < 40; i++) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = await Promise.race([
          page.mouse
            .move(100 + ((i * 7) % 600), 100 + ((i * 13) % 400))
            .then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), STOPPED_MS);
          }),
        ]);
        clearTimeout(timer);
        if (!done) return `move ${i} on the way to ${target}`;
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
      }
      await navigation;
      return null;
    }

    for (const target of [
      `http://localhost:${port}/isolated`,
      `http://127.0.0.1:${port}/plain`,
      `http://localhost:${port}/isolated`,
      `http://127.0.0.1:${port}/plain`,
    ]) {
      expect(
        await moveWhileGoingTo(target),
        'the browser stopped taking the mouse',
      ).toBeNull();
    }
    await page.mouse.click(300, 300);
    await expect.poll(() => page.title()).toBe('clicked');
  });
});
