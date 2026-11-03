// The real-browser lane (`bun run test:camoufox`), whole server: `startServer`
// as `server.ts` calls it, with the real `CamoufoxBackend` and a real Camoufox,
// served over the loopback address and driven the way its users do: the HTTP
// API, the live view's WebSocket, the MCP endpoint, and a stop of the server.
// The proxies and the pages are local; the exit-IP check is scripted (each proxy
// exits through an address the offline GeoIP database knows).
//
// The unit tests of each surface use a fake browser (and `service.camoufox.test.ts`
// the manager with the real one); these show that the surfaces and the browser
// work together: a real JPEG of a page reaches a viewer, a click made on the
// socket reaches the page, an assistant does a job in a page.
//
// Needs `CAMOUFOX_INSTALL_DIR` to hold the Camoufox build (and the GeoIP
// database); without it the tests are skipped.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  metaSchema,
  proxySchema,
  sessionSchema,
  settingsSchema,
} from '../lib/api/schemas.ts';
import type { Session } from '../lib/api/schemas.ts';
import { lookup } from './domains/identity/geo.ts';
import { MCP_TOOL_NAMES } from './domains/mcp/tool.ts';
import { expectJson } from './testing/api-client.ts';
import { HttpProxy } from './testing/local-proxies.ts';
import { McpClient, textOf, unframed } from './testing/mcp-client.ts';
import {
  REAL_BROWSER_READY,
  browserProcesses,
  pageInFront,
} from './testing/real-browser.ts';
import {
  EXIT,
  LAUNCH_TIMEOUT_MS,
  SITE_HOST,
  SITE_HOSTS,
  STOP_TIMEOUT_MS,
} from './testing/real-manager.ts';
import type { ExitPoint } from './testing/real-manager.ts';
import { startSite } from './testing/real-pages.ts';
import type { Site } from './testing/real-pages.ts';
import { startRealServer } from './testing/real-server.ts';
import type { RealServer } from './testing/real-server.ts';
import {
  JpegDecoder,
  RealViewer,
  looksLikeJpeg,
  sizeOfJpeg,
} from './testing/real-viewer.ts';
import { startTestPages } from './testing/test-pages.ts';
import type { TestPages } from './testing/test-pages.ts';

/** One test: a page or two, and a few messages. */
const TIMEOUT_MS = 90_000;
/** What a describe sets up before its tests. */
const SETUP_TIMEOUT_MS = 180_000;
const POLL = { timeout: 30_000, interval: 50 };

describe.skipIf(!REAL_BROWSER_READY)(
  'the whole server with a real browser',
  () => {
    let pages: TestPages;
    let site: Site;
    let decoder: JpegDecoder;

    /** A page of `test-pages.ts` under the host name that the test proxy routes. */
    const onPages = (path: string): string => pages.url(path, SITE_HOST);
    const onSite = (path: string): string => site.url(path, SITE_HOST);

    beforeAll(async () => {
      [pages, site, decoder] = await Promise.all([
        startTestPages(),
        startSite(),
        JpegDecoder.launch(),
      ]);
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
      await decoder?.close();
      await site?.close();
      await pages?.close();
      // Every describe stopped its server: none of this run's browsers is left.
      // A straggler is killed (it is ours) and reported.
      let left = await browserProcesses();
      for (let wait = 0; wait < 100 && left.length > 0; wait++) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        });
        left = await browserProcesses();
      }
      for (const row of left) process.kill(row.pid, 'SIGKILL');
      expect(left.map((row) => row.command)).toEqual([]);
    }, SETUP_TIMEOUT_MS);

    // -- what the tests do to a server --------------------------------------------------------

    /** Until the socket has closed, or `ms` have passed. */
    async function closedWithin(viewer: RealViewer, ms: number): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
      await Promise.race([viewer.closed, expired]);
      clearTimeout(timer);
    }

    async function sessionOf(server: RealServer, id: number): Promise<Session> {
      return await expectJson(
        await server.call('GET', `/api/sessions/${id}`),
        200,
        sessionSchema,
      );
    }

    /** Until the session has this status and no work under way. */
    async function untilStatus(
      server: RealServer,
      id: number,
      status: Session['status'],
      timeout = LAUNCH_TIMEOUT_MS,
    ): Promise<Session> {
      return await vi.waitFor(
        async () => {
          const session = await sessionOf(server, id);
          if (session.status === 'error') {
            throw new Error(`session ${session.name} failed: ${session.error}`);
          }
          expect([session.status, session.activity]).toEqual([status, null]);
          return session;
        },
        { timeout, interval: 50 },
      );
    }

    /** Adds a proxy over the API, exiting through `exit`; returns its id once it is checked. */
    async function addProxy(
      server: RealServer,
      proxy: HttpProxy,
      exit: ExitPoint,
    ): Promise<number> {
      server.checker.setIp(`127.0.0.1:${proxy.port}`, exit.ip, exit.country);
      const added = await expectJson(
        await server.call('POST', '/api/proxies', { proxy: proxy.url }),
        201,
        proxySchema,
      );
      await vi.waitFor(
        async () => {
          const listed = await expectJson(
            await server.call('GET', '/api/proxies'),
            200,
            z.array(proxySchema),
          );
          expect(listed.find((p) => p.id === added.id)?.check.status).toBe(
            'ok',
          );
        },
        { timeout: 30_000, interval: 50 },
      );
      return added.id;
    }

    async function createSession(
      server: RealServer,
      name: string,
    ): Promise<Session> {
      const created = await expectJson(
        await server.call('POST', '/api/sessions', { name, os: 'windows' }),
        201,
        sessionSchema,
      );
      return await untilStatus(server, created.id, 'running');
    }

    /** The Playwright page of the tab in front. */
    function pageOf(server: RealServer, id: number): Page {
      return pageInFront(
        server.backend.sessionIn(server.profileDir(id)),
        server.running.backend.manager.remote(id).tabs(),
      );
    }

    // =============================================================================================
    // 9. the HTTP API and the live view
    // =============================================================================================

    describe('the HTTP API and the live view', () => {
      let server: RealServer;
      let proxy: HttpProxy;
      let id = 0;

      /** A viewer on the session for the length of `work`. */
      async function viewing<T>(
        work: (viewer: RealViewer, page: Page) => Promise<T>,
      ): Promise<T> {
        const viewer = await RealViewer.open(server.streamUrl(id));
        try {
          return await work(viewer, pageOf(server, id));
        } finally {
          viewer.close();
          await closedWithin(viewer, 5000);
        }
      }

      /** Opens the address in the tab in front the way the address bar does, and waits for the page. */
      async function show(
        viewer: RealViewer,
        page: Page,
        url: string,
        selector: string,
      ): Promise<void> {
        viewer.send({ t: 'go', a: 'goto', url });
        await expect.poll(() => page.url(), POLL).toBe(url);
        await page.waitForSelector(selector, { timeout: POLL.timeout });
      }

      async function centerOf(
        page: Page,
        selector: string,
      ): Promise<[number, number]> {
        const box = await page.locator(selector).boundingBox();
        if (box === null) throw new Error(`${selector} is not on the page`);
        return [box.x + box.width / 2, box.y + box.height / 2];
      }

      /** A click made the way the page's viewer makes it: moves and buttons. */
      function click(
        viewer: RealViewer,
        x: number,
        y: number,
        times = 1,
      ): void {
        viewer.send({ t: 'mouse', a: 'move', x, y });
        for (let n = 1; n <= times; n++) {
          viewer.send({ t: 'mouse', a: 'down', x, y, n });
          viewer.send({ t: 'mouse', a: 'up', x, y, n });
        }
      }

      function pressKey(viewer: RealViewer, key: string): void {
        viewer.send({ t: 'key', a: 'down', k: key });
        viewer.send({ t: 'key', a: 'up', k: key });
      }

      /** The colour of a picture at a place: red, green, blue. */
      async function colourAt(
        jpeg: Uint8Array,
        at: readonly [number, number],
      ): Promise<[number, number, number]> {
        const decoded = await decoder.decode(jpeg, [at]);
        const [colour] = decoded.pixels;
        if (colour === undefined) throw new Error('no colour');
        return colour;
      }

      const log = (page: Page): Promise<string | null> =>
        page.textContent('#log');

      beforeAll(async () => {
        proxy = await new HttpProxy({ hosts: SITE_HOSTS }).start();
        server = await startRealServer();
      }, SETUP_TIMEOUT_MS);

      afterAll(async () => {
        await server?.stop();
        await proxy?.stop();
      }, SETUP_TIMEOUT_MS);

      it(
        'creates a session over the HTTP API and starts it in a real browser',
        async () => {
          const settings = await expectJson(
            await server.call('PATCH', '/api/settings', {
              startPage: onPages('/storage.html'),
            }),
            200,
            settingsSchema,
          );
          expect(settings.startPage).toBe(onPages('/storage.html'));
          await addProxy(server, proxy, EXIT.tokyo);

          const created = await expectJson(
            await server.call('POST', '/api/sessions', {
              name: 'viewed',
              os: 'windows',
            }),
            201,
            sessionSchema,
          );
          expect(created).toMatchObject({
            name: 'viewed',
            os: 'windows',
            status: 'starting',
          });
          id = created.id;

          const running = await untilStatus(server, id, 'running');
          expect(running.proxy?.exitIp).toBe(EXIT.tokyo.ip);
          expect(running.location).toMatchObject({
            ip: EXIT.tokyo.ip,
            country: 'JP',
            inSync: true,
          });
          expect(running.fingerprint.userAgent).toMatch(/Windows NT/u);
          const meta = await expectJson(
            await server.call('GET', '/api/meta'),
            200,
            metaSchema,
          );
          expect(meta.counts).toMatchObject({
            sessions: 1,
            running: 1,
            proxies: 1,
          });
          // The start page, through the proxy.
          await vi.waitFor(
            () => {
              expect(proxy.targets('HTTP')).toContain(onPages('/storage.html'));
            },
            { timeout: 30_000, interval: 50 },
          );
        },
        SETUP_TIMEOUT_MS,
      );

      it(
        'streams the tabs and a real JPEG of the page, as big as the tab shows',
        async () => {
          await viewing(async (viewer, page) => {
            const tabs = await viewer.next('tabs');
            expect(tabs.tabs).toHaveLength(1);
            await show(viewer, page, onPages('/form.html'), '#go');

            const picture = await viewer.untilPicture(
              async (candidate) => candidate.view !== null,
              'a picture with its view',
            );
            expect(looksLikeJpeg(picture.jpeg)).toBe(true);
            const { view } = picture;
            expect(view).not.toBeNull();
            const decoded = await decoder.decode(picture.jpeg);
            // The room the tab's page has, in CSS pixels, is what the picture
            // is made of: a window pinned to the size of a fingerprint may give
            // it less than the `innerHeight` it reports (a headless window on
            // macOS keeps the room of a toolbar it does not draw).
            const viewport = z
              .tuple([z.number(), z.number()])
              .parse(
                await page.evaluate(() => [
                  innerWidth,
                  Math.floor(
                    Math.min(
                      innerHeight,
                      visualViewport?.height ?? innerHeight,
                    ),
                  ),
                ]),
              );
            expect([view?.w, view?.h]).toEqual(viewport);
            expect([decoded.width, decoded.height]).toEqual(viewport);
            expect(sizeOfJpeg(picture.jpeg)).toEqual({
              width: decoded.width,
              height: decoded.height,
            });
            expect(view?.tab).toBe(tabs.tabs[0]?.id);
          });
        },
        TIMEOUT_MS,
      );

      it(
        'shows the next pictures what the page looks like after it changed',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#go');
            const hasColour =
              (want: 'red' | 'blue') =>
              async (picture: { jpeg: Uint8Array }) => {
                const [r, g, b] = await colourAt(picture.jpeg, [5, 5]);
                return want === 'red'
                  ? r > 200 && g < 60 && b < 60
                  : b > 200 && r < 60 && g < 60;
              };

            viewer.skipPictures();
            await page.evaluate(() => {
              document.body.style.background = 'rgb(255, 0, 0)';
            });
            const red = await viewer.untilPicture(
              hasColour('red'),
              'a red picture',
            );

            viewer.skipPictures();
            await page.evaluate(() => {
              document.body.style.background = 'rgb(0, 0, 255)';
            });
            const blue = await viewer.untilPicture(
              hasColour('blue'),
              'a blue picture',
            );
            expect(Buffer.from(blue.jpeg).equals(Buffer.from(red.jpeg))).toBe(
              false,
            );
          });
        },
        TIMEOUT_MS,
      );

      it(
        'clicks a button of the page when the viewer clicks it',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#go');
            const [x, y] = await centerOf(page, '#go');

            click(viewer, x, y);
            await expect.poll(() => log(page), POLL).toBe('clicked;');
            click(viewer, x, y);
            await expect.poll(() => log(page), POLL).toBe('clicked;clicked;');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'types into a field the keys and the text the viewer sends',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#name');
            const [x, y] = await centerOf(page, '#name');
            click(viewer, x, y);
            await expect
              .poll(() => page.evaluate(() => document.activeElement?.id), POLL)
              .toBe('name');

            pressKey(viewer, 'h');
            pressKey(viewer, 'i');
            viewer.send({ t: 'text', text: ' there — ü€' });
            pressKey(viewer, 'Backspace');
            await expect
              .poll(() => page.inputValue('#name'), POLL)
              .toBe('hi there — ü');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'selects a word when the viewer double clicks it',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#name');
            const box = await page.locator('#name').boundingBox();
            if (box === null) throw new Error('no field');
            const y = box.y + box.height / 2;
            click(viewer, box.x + 20, y);
            viewer.send({ t: 'text', text: 'hello world' });
            await expect
              .poll(() => page.inputValue('#name'), POLL)
              .toBe('hello world');

            click(viewer, box.x + 20, y, 2);
            await expect
              .poll(
                () =>
                  page.evaluate(() => {
                    const field = document.activeElement;
                    return field instanceof HTMLInputElement
                      ? field.value.slice(
                          field.selectionStart ?? 0,
                          field.selectionEnd ?? 0,
                        )
                      : null;
                  }),
                POLL,
              )
              .toBe('hello');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'hands the viewer the selection of the page when it copies, and takes it out when it cuts',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#name');
            const box = await page.locator('#name').boundingBox();
            if (box === null) throw new Error('no field');
            const y = box.y + box.height / 2;
            click(viewer, box.x + 20, y);
            viewer.send({ t: 'text', text: 'hello world' });
            click(viewer, box.x + 20, y, 2);

            viewer.send({ t: 'copy', cut: false });
            expect(await viewer.next('selection')).toEqual({
              t: 'selection',
              text: 'hello',
              cut: false,
            });
            expect(await page.inputValue('#name')).toBe('hello world');

            viewer.send({ t: 'copy', cut: true });
            expect(await viewer.next('selection')).toEqual({
              t: 'selection',
              text: 'hello',
              cut: true,
            });
            // The word is gone (Firefox takes the space after a double-clicked
            // word with it).
            await expect
              .poll(async () => (await page.inputValue('#name')).trim(), POLL)
              .toBe('world');
          });
        },
        TIMEOUT_MS,
      );

      it.each(['Control', 'Meta'])(
        'takes the selection out when it cuts with %s held down, as the shortcut of a viewer does',
        async (modifier) => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#name');
            const box = await page.locator('#name').boundingBox();
            if (box === null) throw new Error('no field');
            const y = box.y + box.height / 2;
            click(viewer, box.x + 20, y);
            viewer.send({ t: 'text', text: 'hello world' });
            click(viewer, box.x + 20, y, 2);

            // Ctrl or Command is down in the page while it is asked to cut: a
            // Delete pressed under it is no deletion.
            viewer.send({ t: 'key', a: 'down', k: modifier });
            viewer.send({ t: 'copy', cut: true });
            expect(await viewer.next('selection')).toEqual({
              t: 'selection',
              text: 'hello',
              cut: true,
            });
            await expect
              .poll(async () => (await page.inputValue('#name')).trim(), POLL)
              .toBe('world');
            viewer.send({ t: 'key', a: 'up', k: modifier });
          });
        },
        TIMEOUT_MS,
      );

      it(
        'hands the viewer text selected in the page itself when it copies',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/read.html'), 'p');
            const box = await page.locator('p').first().boundingBox();
            if (box === null) throw new Error('no paragraph');
            const y = box.y + box.height / 2;
            // A drag over the paragraph, as the mouse makes it.
            viewer.send({ t: 'mouse', a: 'move', x: box.x + 1, y });
            viewer.send({ t: 'mouse', a: 'down', x: box.x + 1, y });
            viewer.send({ t: 'mouse', a: 'move', x: box.x + box.width - 1, y });
            viewer.send({ t: 'mouse', a: 'up', x: box.x + box.width - 1, y });

            await vi.waitFor(async () => {
              viewer.send({ t: 'copy', cut: false });
              const copied = await viewer.next('selection');
              expect(copied.text).toContain('Some text in a paragraph.');
            }, POLL);
          });
        },
        TIMEOUT_MS,
      );

      it(
        'scrolls the page with the wheel, and the pictures show it',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/long.html'), 'div');
            const first = await viewer.untilPicture(
              async (picture) => picture.view !== null,
              'a first picture',
            );
            const scrollY = () => page.evaluate(() => window.scrollY);

            viewer.send({ t: 'wheel', x: 400, y: 300, dx: 0, dy: 100 });
            await expect.poll(scrollY, POLL).toBe(100);
            viewer.send({ t: 'wheel', x: 400, y: 300, dx: 0, dy: 200 });
            await expect.poll(scrollY, POLL).toBe(300);

            viewer.skipPictures();
            viewer.send({ t: 'wheel', x: 400, y: 300, dx: 0, dy: 250 });
            await expect.poll(scrollY, POLL).toBe(550);
            const later = await viewer.untilPicture(
              async (picture) =>
                !Buffer.from(picture.jpeg).equals(Buffer.from(first.jpeg)),
              'another picture',
            );
            expect(looksLikeJpeg(later.jpeg)).toBe(true);
          });
        },
        TIMEOUT_MS,
      );

      it(
        'sends a drop-down list the browser would draw itself as a select message, and passes the choice back',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/form.html'), '#country');
            const [x, y] = await centerOf(page, '#country');

            click(viewer, x, y);
            const menu = await viewer.next('select');
            expect(menu.options).toEqual([
              {
                label: 'Switzerland',
                selected: true,
                disabled: false,
                group: null,
              },
              {
                label: 'Germany',
                selected: false,
                disabled: false,
                group: null,
              },
              {
                label: 'France',
                selected: false,
                disabled: false,
                group: null,
              },
            ]);
            const box = await page.locator('#country').boundingBox();
            expect(menu.x).toBeCloseTo(box?.x ?? Number.NaN, 1);
            expect(menu.y).toBeCloseTo(box?.y ?? Number.NaN, 1);

            viewer.send({ t: 'pick', token: menu.token, index: 2 });
            await expect
              .poll(() => page.inputValue('#country'), POLL)
              .toBe('fr');
            expect(await log(page)).toContain('country=fr;');

            // A list that is dismissed changes nothing.
            click(viewer, x, y);
            const again = await viewer.next('select');
            viewer.send({ t: 'pick', token: again.token, index: null });
            click(viewer, ...(await centerOf(page, '#go')));
            await expect.poll(() => log(page), POLL).toContain('clicked;');
            expect(await page.inputValue('#country')).toBe('fr');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'sends alert, confirm and prompt as dialog messages, and the page gets the answers',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onPages('/dialogs.html'), '#alert');

            click(viewer, ...(await centerOf(page, '#alert')));
            const alert = await viewer.next('dialog');
            expect(alert).toMatchObject({ kind: 'alert', message: 'Heads up' });
            viewer.send({ t: 'answer', id: alert.id, accept: true });
            expect((await viewer.next('dialog_closed')).id).toBe(alert.id);
            await expect.poll(() => log(page), POLL).toBe('alerted;');

            click(viewer, ...(await centerOf(page, '#confirm')));
            const confirm = await viewer.next('dialog');
            expect(confirm).toMatchObject({
              kind: 'confirm',
              message: 'Sure?',
            });
            viewer.send({ t: 'answer', id: confirm.id, accept: true });
            await expect
              .poll(() => log(page), POLL)
              .toBe('alerted;confirm=true;');

            click(viewer, ...(await centerOf(page, '#prompt')));
            const prompt = await viewer.next('dialog');
            expect(prompt).toMatchObject({
              kind: 'prompt',
              message: 'Name?',
              default: 'Ann',
            });
            viewer.send({
              t: 'answer',
              id: prompt.id,
              accept: true,
              text: 'Bob',
            });
            await expect
              .poll(() => log(page), POLL)
              .toBe('alerted;confirm=true;prompt=Bob;');

            // Cancelled, a confirm says false and a prompt null.
            click(viewer, ...(await centerOf(page, '#confirm')));
            const refused = await viewer.next('dialog');
            viewer.send({ t: 'answer', id: refused.id, accept: false });
            await expect
              .poll(() => log(page), POLL)
              .toBe('alerted;confirm=true;prompt=Bob;confirm=false;');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'passes keys with their modifiers to the page',
        async () => {
          await viewing(async (viewer, page) => {
            await show(viewer, page, onSite('/keys.html'), '#field');
            const [x, y] = await centerOf(page, '#field');
            click(viewer, x, y);
            await expect
              .poll(() => page.evaluate(() => document.activeElement?.id), POLL)
              .toBe('field');

            // A capital: Shift, then the key the viewer's keyboard says.
            viewer.send({ t: 'key', a: 'down', k: 'Shift' });
            pressKey(viewer, 'A');
            viewer.send({ t: 'key', a: 'up', k: 'Shift' });
            await expect.poll(() => page.inputValue('#field'), POLL).toBe('A');
            // Control with a letter.
            viewer.send({ t: 'key', a: 'down', k: 'Control' });
            pressKey(viewer, 'x');
            viewer.send({ t: 'key', a: 'up', k: 'Control' });
            // Both together, and then a key without any.
            viewer.send({ t: 'key', a: 'down', k: 'Control' });
            viewer.send({ t: 'key', a: 'down', k: 'Shift' });
            pressKey(viewer, 'Y');
            viewer.send({ t: 'key', a: 'up', k: 'Shift' });
            viewer.send({ t: 'key', a: 'up', k: 'Control' });
            pressKey(viewer, 'z');

            await expect
              .poll(
                async () =>
                  ((await page.textContent('#log')) ?? '').trim().split('\n'),
                POLL,
              )
              .toEqual([
                'Shift|S',
                'A|S',
                'Control|C',
                'x|C',
                'Control|C',
                'Shift|CS',
                'Y|CS',
                'z|',
              ]);
          });
        },
        TIMEOUT_MS,
      );

      it(
        'lets go of a key that a viewer held down when its connection ends, so that the next viewer types without it',
        async () => {
          // The first viewer presses Shift and goes away without letting it go.
          await viewing(async (viewer, page) => {
            await show(viewer, page, onSite('/keys.html'), '#field');
            const [x, y] = await centerOf(page, '#field');
            click(viewer, x, y);
            await expect
              .poll(() => page.evaluate(() => document.activeElement?.id), POLL)
              .toBe('field');
            viewer.send({ t: 'key', a: 'down', k: 'Shift' });
            await expect
              .poll(async () => (await log(page))?.trim(), POLL)
              .toBe('Shift|S');
          });

          // The next one types a letter: with Shift still down in the browser it would be a capital.
          await viewing(async (viewer, page) => {
            pressKey(viewer, 'z');
            await expect
              .poll(async () => (await log(page))?.trim().split('\n'), POLL)
              .toEqual(['Shift|S', 'z|']);
            expect(await page.inputValue('#field')).toBe('z');
          });
        },
        TIMEOUT_MS,
      );

      it(
        'opens, switches and closes tabs on the viewer’s request',
        async () => {
          await viewing(async (viewer) => {
            const lastTabs = () => viewer.of('tabs').at(-1)?.tabs ?? [];
            await expect.poll(() => lastTabs().length, POLL).toBe(1);
            const [first] = lastTabs();

            viewer.send({ t: 'tab', a: 'open', url: onPages('/long.html') });
            await expect.poll(() => lastTabs().length, POLL).toBe(2);
            const second = lastTabs()[1];
            expect(second?.active).toBe(true);
            await expect
              .poll(() => lastTabs()[1]?.url, POLL)
              .toBe(onPages('/long.html'));

            viewer.send({ t: 'tab', a: 'activate', id: first?.id });
            await expect
              .poll(() => lastTabs().map((tab) => tab.active), POLL)
              .toEqual([true, false]);

            viewer.send({ t: 'tab', a: 'close', id: second?.id });
            await expect.poll(() => lastTabs().length, POLL).toBe(1);
          });
        },
        TIMEOUT_MS,
      );

      it(
        'tells a viewer that the browser is gone when the session is stopped, and tells a later viewer that it is not running',
        async () => {
          const viewer = await RealViewer.open(server.streamUrl(id));
          await viewer.next('tabs');

          const stopping = await server.call(
            'POST',
            `/api/sessions/${id}/stop`,
          );
          expect(stopping.status).toBe(202);

          await viewer.next('closed');
          expect((await viewer.closed).code).toBe(1000);
          const stopped = await untilStatus(
            server,
            id,
            'stopped',
            STOP_TIMEOUT_MS,
          );
          expect(stopped.error).toBeNull();

          const late = await RealViewer.open(server.streamUrl(id));
          expect(await late.next('error')).toMatchObject({
            t: 'error',
            code: 'session_not_running',
          });
          expect((await late.closed).code).toBe(1000);
        },
        TIMEOUT_MS,
      );
    });

    // =============================================================================================
    // 10. the MCP endpoint
    // =============================================================================================

    describe('the MCP endpoint', () => {
      let server: RealServer;
      let proxy: HttpProxy;
      let ai: McpClient;

      const mcpUrl = (): string => `${server.origin}/mcp`;

      beforeAll(async () => {
        proxy = await new HttpProxy({ hosts: SITE_HOSTS }).start();
        server = await startRealServer();
        server.checker.setIp(`127.0.0.1:${proxy.port}`, EXIT.chicago.ip, 'US');
        ai = new McpClient(mcpUrl());
      }, SETUP_TIMEOUT_MS);

      afterAll(async () => {
        await server?.stop();
        await proxy?.stop();
      }, SETUP_TIMEOUT_MS);

      it(
        'answers 403 while AI access is off',
        async () => {
          const initialize = await ai.post({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'test', version: '1' },
            },
          });
          expect(initialize.status).toBe(403);
          expect(initialize.body).toMatchObject({ error: 'ai_access_off' });

          const listing = await ai.post({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
          });
          expect(listing.status).toBe(403);
          expect((await fetch(mcpUrl())).status).toBe(403);
        },
        TIMEOUT_MS,
      );

      it(
        'introduces itself and lists its tools once AI access is on',
        async () => {
          const switched = await expectJson(
            await server.call('PATCH', '/api/settings', { mcpEnabled: true }),
            200,
            settingsSchema,
          );
          expect(switched.mcpEnabled).toBe(true);

          const hello = await ai.initialize();
          expect(hello.serverInfo).toMatchObject({ name: 'session-manager' });
          expect(hello.capabilities).toHaveProperty('tools');
          expect(hello.instructions).toContain('Start with overview');

          const tools = await ai.tools();
          expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
          for (const tool of tools) {
            expect(tool.inputSchema, tool.name).toMatchObject({
              type: 'object',
            });
            expect(tool.description.length, tool.name).toBeGreaterThan(10);
          }
          // Event streams are not offered.
          expect((await fetch(mcpUrl())).status).toBe(405);
        },
        TIMEOUT_MS,
      );

      it(
        'does a short job in a real browser: a session, a page, a click, a field, a picture, the tabs, a stop',
        async () => {
          // The pool: one proxy, added the way an assistant adds it.
          const added = z
            .object({
              summary: z.string(),
              added: z.array(z.object({ id: z.number() })),
            })
            .parse(await ai.value('add_proxies', { text: proxy.url }));
          expect(added.added).toHaveLength(1);
          await vi.waitFor(
            async () => {
              const pool = z
                .object({ proxies: z.array(z.object({ health: z.string() })) })
                .parse(await ai.value('list_proxies', { only: 'free' }));
              expect(pool.proxies.map((p) => p.health)).toEqual(['ok']);
            },
            { timeout: 30_000, interval: 50 },
          );
          await ai.value('set_start_page', { url: onPages('/storage.html') });

          // A session, which comes back running.
          const created = z
            .object({
              id: z.number(),
              name: z.string(),
              status: z.string(),
              tabs: z.number(),
              timezone: z.string().nullable(),
            })
            .parse(
              await ai.value('create_session', {
                name: 'assistant',
                os: 'linux',
              }),
            );
          expect(created).toMatchObject({
            name: 'assistant',
            status: 'running',
            tabs: 1,
            timezone: (await lookup(EXIT.chicago.ip)).timezone,
          });

          // A page, read.
          const form = onPages('/form.html');
          const opened = await ai.text('navigate', {
            session: 'assistant',
            url: form,
          });
          expect(unframed(opened)).toBe(`URL: ${form}\nTitle: form`);
          const read = unframed(
            await ai.text('read_page', { session: 'assistant' }),
          );
          expect(read).toContain(`URL: ${form}`);
          expect(read).toContain('Title: form');
          const elementOf = (
            text: string,
            role: string,
            name: string,
          ): number => {
            const match = new RegExp(
              `^\\[(\\d+)\\] ${role} “${name}”`,
              'mu',
            ).exec(text);
            if (match === null)
              throw new Error(`no ${role} “${name}” in\n${text}`);
            return Number(match[1]);
          };

          // A click, and what it did.
          const go = elementOf(read, 'button', 'Go');
          expect(
            await ai.text('click', { session: 'assistant', element: go }),
          ).toMatch(/^Clicked\./u);
          expect(
            unframed(await ai.text('read_page', { session: 'assistant' })),
          ).toContain('clicked;');

          // A field.
          const field = elementOf(read, 'textbox', 'name');
          expect(
            await ai.text('type_text', {
              session: 'assistant',
              element: field,
              text: 'Ada Lovelace',
            }),
          ).toMatch(/^Typed\./u);
          const filled = unframed(
            await ai.text('read_page', { session: 'assistant' }),
          );
          expect(filled).toContain('value “Ada Lovelace”');
          expect(filled).toContain('name=Ada Lovelace;');

          // A picture: a real image of the page.
          const shot = await ai.call('screenshot', { session: 'assistant' });
          expect(shot.isError).toBeUndefined();
          const [image] = shot.content;
          expect(image).toMatchObject({
            type: 'image',
            mimeType: 'image/jpeg',
          });
          const bytes = Buffer.from(
            image?.type === 'image' ? image.data : '',
            'base64',
          );
          expect(looksLikeJpeg(bytes)).toBe(true);
          const decoded = await decoder.decode(bytes);
          expect(decoded.width).toBeGreaterThan(400);
          expect(decoded.height).toBeGreaterThan(300);
          expect(sizeOfJpeg(bytes)).toEqual({
            width: decoded.width,
            height: decoded.height,
          });

          // The tabs.
          const tabs = z
            .array(
              z.object({
                id: z.number(),
                url: z.string(),
                title: z.string(),
                active: z.boolean(),
              }),
            )
            .parse(await ai.framedValue('list_tabs', { session: 'assistant' }));
          expect(tabs).toEqual([
            expect.objectContaining({ url: form, title: 'form', active: true }),
          ]);

          // A stop.
          const stopped = z
            .object({ status: z.string(), error: z.string().nullable() })
            .parse(await ai.value('stop_session', { session: 'assistant' }));
          expect(stopped).toEqual({ status: 'stopped', error: null });
          const listed = z
            .array(z.object({ name: z.string(), status: z.string() }))
            .parse(await ai.value('list_sessions'));
          expect(listed).toEqual([{ name: 'assistant', status: 'stopped' }]);
          expect(textOf(await ai.call('overview'))).toContain(
            '"installed": true',
          );
        },
        SETUP_TIMEOUT_MS,
      );
    });

    // =============================================================================================
    // 11. stopping the server
    // =============================================================================================

    describe('stopping the server', () => {
      it(
        'closes every browser and releases the port, and the next start brings the sessions back stopped with their data',
        async () => {
          const root = mkdtempSync(join(tmpdir(), 'sm-stack-restart-'));
          const marker = basename(root);
          const proxyA = await new HttpProxy({ hosts: SITE_HOSTS }).start();
          const proxyB = await new HttpProxy({ hosts: SITE_HOSTS }).start();
          const processesBefore = new Set(
            (await browserProcesses()).map((row) => row.pid),
          );
          let first: RealServer | undefined;
          let second: RealServer | undefined;
          try {
            first = await startRealServer({ root });
            const { port } = first;
            await first.call('PATCH', '/api/settings', {
              startPage: onPages('/storage.html'),
            });
            await addProxy(first, proxyA, EXIT.tokyo);
            const a = await createSession(first, 'a');
            await addProxy(first, proxyB, EXIT.berlin);
            const b = await createSession(first, 'b');

            // Session a has a cookie and a second tab.
            const remote = first.running.backend.manager.remote(a.id);
            await vi.waitFor(() => expect(remote.tabs()).toHaveLength(1), POLL);
            const page = pageOf(first, a.id);
            await vi.waitFor(
              () => expect(page.url()).toBe(onPages('/storage.html')),
              POLL,
            );
            await page.evaluate(() => {
              document.cookie = 'owner=a; max-age=86400; path=/';
            });
            await remote.openTab(onPages('/long.html'));
            await vi.waitFor(() => expect(remote.tabs()).toHaveLength(2), POLL);
            await vi.waitFor(async () => {
              const tabs = await remote.listTabs();
              expect(tabs.map((tab) => tab.title)).toEqual(['storage', 'long']);
            }, POLL);
            const listed = await expectJson(
              await first.call('GET', '/api/sessions'),
              200,
              z.array(sessionSchema),
            );
            expect(await browserProcesses(marker)).not.toEqual([]);

            await first.stop();

            // The port is free again, and nothing of the browsers is left.
            await expect(fetch(`${first.origin}/api/health`)).rejects.toThrow();
            const taken = Bun.serve({ port, fetch: () => new Response() });
            await taken.stop(true);
            await expect
              .poll(() => browserProcesses(marker), {
                timeout: 30_000,
                interval: 100,
              })
              .toEqual([]);
            const processesAfter = await browserProcesses();
            expect(
              processesAfter.filter((row) => !processesBefore.has(row.pid)),
            ).toEqual([]);

            // The next start finds both sessions where they were: stopped, with their identity, place and proxy.
            second = await startRealServer({ root });
            for (const proxy of [proxyA, proxyB]) {
              const exit = proxy === proxyA ? EXIT.tokyo : EXIT.berlin;
              second.checker.setIp(
                `127.0.0.1:${proxy.port}`,
                exit.ip,
                exit.country,
              );
            }
            const again = await expectJson(
              await second.call('GET', '/api/sessions'),
              200,
              z.array(sessionSchema),
            );
            expect(again.map((session) => session.status)).toEqual([
              'stopped',
              'stopped',
            ]);
            // Only a running session knows whether its proxy still exits where it did.
            const strip = (session: Session) => ({
              ...session,
              status: 'stopped',
              activity: null,
              location:
                session.location === null
                  ? null
                  : { ...session.location, inSync: null },
            });
            expect(again.map(strip)).toEqual(listed.map(strip));
            expect(again.map((session) => session.name).sort()).toEqual([
              'a',
              'b',
            ]);
            expect(
              again.every(
                (session) =>
                  session.proxy !== null && session.location !== null,
              ),
            ).toBe(true);

            // Starting one of them brings its tabs and its cookie back.
            const resumed = await expectJson(
              await second.call('POST', `/api/sessions/${a.id}/start`),
              202,
              sessionSchema,
            );
            expect(resumed.status).toBe('starting');
            const running = await untilStatus(second, a.id, 'running');
            expect(running.fingerprint).toEqual(a.fingerprint);
            const remoteAgain = second.running.backend.manager.remote(a.id);
            await vi.waitFor(
              () =>
                expect(remoteAgain.tabs().map((tab) => tab.url)).toEqual([
                  onPages('/storage.html'),
                  onPages('/long.html'),
                ]),
              POLL,
            );
            expect(
              await pageOf(second, a.id).evaluate(() => document.cookie),
            ).toBe('owner=a');
            expect(b.id).not.toBe(a.id);
            expect((await sessionOf(second, b.id)).status).toBe('stopped');
          } finally {
            await second?.stop();
            await first?.stop();
            await proxyA.stop();
            await proxyB.stop();
            rmSync(root, { recursive: true, force: true });
          }
        },
        SETUP_TIMEOUT_MS,
      );
    });
  },
);
