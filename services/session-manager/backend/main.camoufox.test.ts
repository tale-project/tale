// The real-browser lane (`bun run test:camoufox`), whole server: `startServer`
// as `server.ts` calls it, with the real `CamoufoxBackend` and a real Camoufox
// (headless: the lane runs where there is no screen), served over the loopback
// address and driven the way its users do: the HTTP API, the MCP endpoint, and
// a stop of the server. The proxies and the pages are local; the exit-IP check
// is scripted (each proxy exits through an address the offline GeoIP database
// knows).
//
// The unit tests of each surface use a fake browser (and `service.camoufox.test.ts`
// the manager with the real one); these show that the surfaces and the browser
// work together: a value the page types reaches the field that has the focus,
// an assistant does a job in a page.
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
import { expectError, expectJson } from './testing/api-client.ts';
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
import { startRealServer } from './testing/real-server.ts';
import type { RealServer } from './testing/real-server.ts';
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

    /** A page of `test-pages.ts` under the host name that the test proxy routes. */
    const onPages = (path: string): string => pages.url(path, SITE_HOST);

    beforeAll(async () => {
      pages = await startTestPages();
    }, SETUP_TIMEOUT_MS);

    afterAll(async () => {
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
    // 9. the HTTP API, and the window of a session
    // =============================================================================================

    describe('the HTTP API and the window of a session', () => {
      let server: RealServer;
      let proxy: HttpProxy;
      let id = 0;

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
              name: 'windowed',
              os: 'windows',
            }),
            201,
            sessionSchema,
          );
          expect(created).toMatchObject({
            name: 'windowed',
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
        'brings the tab of the session forward when the window is asked for',
        async () => {
          const response = await server.call(
            'POST',
            `/api/sessions/${id}/show`,
          );
          expect(response.status).toBe(204);
        },
        TIMEOUT_MS,
      );

      it(
        'types a value into the field that has the focus, and nothing while no field has it',
        async () => {
          const page = pageOf(server, id);
          await page.goto(onPages('/form.html'));
          await page.waitForSelector('#name', { timeout: POLL.timeout });
          // The person clicked into the field in the window.
          await page.click('#name');

          const typed = await server.call('POST', `/api/sessions/${id}/type`, {
            text: 'hunter2 — ü€',
          });
          expect(typed.status).toBe(204);
          await expect
            .poll(() => page.inputValue('#name'), POLL)
            .toBe('hunter2 — ü€');

          await page.evaluate(() => {
            const focused = document.activeElement;
            if (focused instanceof HTMLElement) focused.blur();
          });
          await expectError(
            await server.call('POST', `/api/sessions/${id}/type`, {
              text: 'nowhere',
            }),
            409,
            'no_field_focused',
          );
          expect(await page.inputValue('#name')).toBe('hunter2 — ü€');
        },
        TIMEOUT_MS,
      );

      it(
        'refuses to show or type into a session that is not running',
        async () => {
          await expectJson(
            await server.call('POST', `/api/sessions/${id}/stop`),
            202,
            sessionSchema,
          );
          await untilStatus(server, id, 'stopped', STOP_TIMEOUT_MS);
          await expectError(
            await server.call('POST', `/api/sessions/${id}/show`),
            409,
            'session_not_running',
          );
          await expectError(
            await server.call('POST', `/api/sessions/${id}/type`, {
              text: 'x',
            }),
            409,
            'session_not_running',
          );
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
          // A JPEG (it starts and ends as one) of a page, not of nothing.
          expect([...bytes.subarray(0, 3), ...bytes.subarray(-2)]).toEqual([
            0xff, 0xd8, 0xff, 0xff, 0xd9,
          ]);
          expect(bytes.length).toBeGreaterThan(2000);

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
