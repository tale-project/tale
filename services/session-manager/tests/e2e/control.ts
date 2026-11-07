/*
  The remote control of the fakes behind a server of `tests/e2e/server.ts`
  (`startE2eServer`), for specs. The server runs in another process than the
  spec, so a spec cannot reach the fake browser the way a unit test does; this
  small HTTP server (loopback only, one per server: `E2E_CONTROL_PORT` plus the
  server's index) hands it over. `tests/e2e/helpers/control.ts` is the client,
  given the address of its own worker's server.

    GET    /browsers/:name          what the latest browser launched for the
                                    session `:name` has been told (`events`),
                                    its tabs, its open dialogs and whether it
                                    is closed
    POST   /browsers/:name/dialog   { kind, message, defaultValue? }: the page
                                    opens a dialog
    POST   /browsers/:name/focus    { field }: whether a field of the window
                                    has the focus, which typed text needs
    POST   /browsers/:name/crash    the browser dies
    POST   /browsers/:name/close-tabs the user closes every tab
    PUT    /faults                  { launchError?, launchDelayMs?, checkDelayMs?,
                                      identityError? }: the next launches and
                                    checks go wrong or slow
    PUT    /exit-ips                { "<host:port>": { ip, country? } | { error } }
    DELETE /state                   the fakes as they were at the start
*/

import { z } from 'zod';

import { IdentityError } from '../../backend/domains/identity/types.ts';
import type {
  FakeBackend,
  FakeBrowser,
} from '../../backend/testing/fake-browser.ts';
import type { FakeExitIpChecker } from '../../backend/testing/fake-exit-ip.ts';

export interface ControlDefaults {
  launchDelayMs: number;
  checkDelayMs: number;
}

interface ControlDeps {
  backend: FakeBackend;
  checker: FakeExitIpChecker;
  defaults: ControlDefaults;
}

const dialogSchema = z.object({
  kind: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']).default('alert'),
  message: z.string().default('Hello from the page'),
  defaultValue: z.string().default(''),
});

const focusSchema = z.object({ field: z.boolean() });

const faultsSchema = z.object({
  launchError: z.string().nullish(),
  identityError: z.string().nullish(),
  launchDelayMs: z.number().int().min(0).optional(),
  checkDelayMs: z.number().int().min(0).optional(),
});

const exitIpsSchema = z.record(
  z.string(),
  z.union([
    z.object({ ip: z.string(), country: z.string().nullish() }),
    z.object({ error: z.string() }),
  ]),
);

function notFound(what: string): Response {
  return Response.json({ error: `${what} not found` }, { status: 404 });
}

/** The latest browser launched for the session of this name. */
function browserOf(backend: FakeBackend, name: string): FakeBrowser | null {
  return backend.launches.findLast((one) => one.spec.name === name) ?? null;
}

function describeBrowser(browser: FakeBrowser) {
  return {
    name: browser.spec.name,
    closed: browser.closed,
    events: browser.remote.events,
    tabs: browser.remote.tabs(),
    dialogs: browser.remote.dialogs(),
  };
}

export function startControlServer(
  port: number,
  { backend, checker, defaults }: ControlDeps,
) {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const method = request.method;

      const found = /^\/browsers\/([^/]+)(?:\/([a-z-]+))?$/.exec(pathname);
      if (found !== null) {
        const name = decodeURIComponent(found[1] ?? '');
        const action = found[2];
        const browser = browserOf(backend, name);
        if (browser === null) return notFound(`a browser for session ${name}`);
        const { remote } = browser;

        if (method === 'GET' && action === undefined) {
          return Response.json(describeBrowser(browser));
        }
        if (method !== 'POST') return notFound(pathname);
        switch (action) {
          case 'dialog': {
            const dialog = dialogSchema.parse(await request.json());
            return Response.json(
              remote.openDialog(
                dialog.kind,
                dialog.message,
                dialog.defaultValue,
              ),
            );
          }
          case 'focus': {
            remote.fieldFocused = focusSchema.parse(await request.json()).field;
            return Response.json({ ok: true });
          }
          case 'crash':
            browser.crash();
            return Response.json({ ok: true });
          case 'close-tabs':
            await browser.closeAllTabs();
            return Response.json({ ok: true });
          default:
            return notFound(pathname);
        }
      }

      if (pathname === '/faults' && method === 'PUT') {
        const faults = faultsSchema.parse(await request.json());
        if (faults.launchError !== undefined) {
          backend.launchError =
            faults.launchError === null ? null : new Error(faults.launchError);
        }
        if (faults.identityError !== undefined) {
          backend.identityError =
            faults.identityError === null
              ? null
              : new IdentityError(faults.identityError);
        }
        if (faults.launchDelayMs !== undefined) {
          backend.launchDelayMs = faults.launchDelayMs;
        }
        if (faults.checkDelayMs !== undefined) {
          checker.delayMs = faults.checkDelayMs;
        }
        return Response.json({ ok: true });
      }

      if (pathname === '/exit-ips' && method === 'PUT') {
        const answers = exitIpsSchema.parse(await request.json());
        for (const [proxy, answer] of Object.entries(answers)) {
          if ('error' in answer) checker.setError(proxy, answer.error);
          else checker.setIp(proxy, answer.ip, answer.country ?? null);
        }
        return Response.json({ ok: true });
      }

      if (pathname === '/state' && method === 'DELETE') {
        backend.launchError = null;
        backend.identityError = null;
        backend.launchDelayMs = defaults.launchDelayMs;
        backend.geoByIp.clear();
        checker.results.clear();
        checker.delayMs = defaults.checkDelayMs;
        return Response.json({ ok: true });
      }

      return notFound(pathname);
    },
  });
}
