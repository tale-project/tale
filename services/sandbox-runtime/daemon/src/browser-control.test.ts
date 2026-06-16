import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closePages,
  probeCdp,
  resetBrowser,
  restartBrowser,
} from './browser-control.ts';

// browser-control talks plain CDP HTTP (/json/version, /json/list, /json/close)
// + a CDP WebSocket round-trip (Target.getTargets) over node built-ins. The
// endpoint host/port + control dir are env-overridable (like screencast-tunnel's
// target host/port), so we point them at a Bun stub here. No real Chromium.

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
}

type StubServer = ReturnType<typeof Bun.serve>;

/** A stub CDP endpoint: answers /json/version with a ws url back to itself,
 * /json/list with `targets`, /json/close/* with text, and (unless
 * `wedged`) replies to a Target.getTargets WS round-trip. `wedged` simulates a
 * hung browser whose HTTP listener answers but whose CDP session never does. */
function startStubCdp(opts: {
  targets: CdpTarget[];
  wedged?: boolean;
}): StubServer {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      const path = new URL(req.url).pathname;
      if (path.startsWith('/devtools/')) {
        return server.upgrade(req, { data: undefined })
          ? undefined
          : new Response('upgrade failed', { status: 400 });
      }
      if (path === '/json/version') {
        return Response.json({
          webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/stub`,
        });
      }
      if (path === '/json/list') return Response.json(opts.targets);
      if (path.startsWith('/json/close/'))
        return new Response('Target is closing');
      return new Response('not found', { status: 404 });
    },
    websocket: {
      message(ws, message) {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        const msg = JSON.parse(String(message)) as {
          id: number;
          method: string;
        };
        if (msg.method === 'Target.getTargets' && !opts.wedged) {
          ws.send(
            JSON.stringify({
              id: msg.id,
              result: { targetInfos: opts.targets },
            }),
          );
        }
        // wedged: never reply → the round-trip times out (unhealthy).
      },
    },
  });
}

/** Bind+release a port to get one that is (very likely) free, for the
 * connection-refused paths. */
function aClosedPort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response('x') });
  const port = s.port ?? 0;
  void s.stop(true);
  return port;
}

const servers: StubServer[] = [];
const tmpDirs: string[] = [];
const PREV = {
  host: process.env.TALE_CDP_HOST,
  port: process.env.TALE_CDP_PORT,
  ctrl: process.env.TALE_BROWSER_CTRL_DIR,
};

function pointAt(server: StubServer): void {
  process.env.TALE_CDP_HOST = '127.0.0.1';
  process.env.TALE_CDP_PORT = String(server.port);
  servers.push(server);
}

afterEach(() => {
  for (const s of servers.splice(0)) void s.stop(true);
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
  process.env.TALE_CDP_HOST = PREV.host;
  process.env.TALE_CDP_PORT = PREV.port;
  process.env.TALE_BROWSER_CTRL_DIR = PREV.ctrl;
});

describe('probeCdp', () => {
  test('healthy + counts page tabs via the CDP round-trip', async () => {
    pointAt(
      startStubCdp({
        targets: [
          { id: 'a', type: 'page' },
          { id: 'b', type: 'page' },
          { id: 'c', type: 'background_page' },
        ],
      }),
    );
    const health = await probeCdp(1_000);
    expect(health.healthy).toBe(true);
    expect(health.tabs).toBe(2);
  });

  test('unhealthy when nothing is listening (connection refused)', async () => {
    process.env.TALE_CDP_HOST = '127.0.0.1';
    process.env.TALE_CDP_PORT = String(aClosedPort());
    const health = await probeCdp(500);
    expect(health.healthy).toBe(false);
    expect(health.tabs).toBe(0);
  });

  test('unhealthy when HTTP answers but the CDP session is wedged', async () => {
    pointAt(
      startStubCdp({ targets: [{ id: 'a', type: 'page' }], wedged: true }),
    );
    const health = await probeCdp(400);
    expect(health.healthy).toBe(false);
  });
});

describe('closePages', () => {
  test('closes only page targets, leaving cookies untouched', async () => {
    pointAt(
      startStubCdp({
        targets: [
          { id: 'p1', type: 'page' },
          { id: 'p2', type: 'page' },
          { id: 'sw', type: 'service_worker' },
        ],
      }),
    );
    const { closed } = await closePages();
    expect(closed).toBe(2);
  });

  test('no-ops (closed:0) when the endpoint is unreachable', async () => {
    process.env.TALE_CDP_HOST = '127.0.0.1';
    process.env.TALE_CDP_PORT = String(aClosedPort());
    const { closed } = await closePages();
    expect(closed).toBe(0);
  });
});

describe('restartBrowser', () => {
  test('signalled:false when no pid file (no managed browser)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-browser-'));
    tmpDirs.push(dir);
    process.env.TALE_BROWSER_CTRL_DIR = dir;
    process.env.TALE_CDP_HOST = '127.0.0.1';
    process.env.TALE_CDP_PORT = String(aClosedPort());
    const r = await restartBrowser(200);
    expect(r.signalled).toBe(false);
    expect(r.ready).toBe(false);
  });
});

describe('resetBrowser', () => {
  test('drops the reset flag the supervisor honors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-browser-'));
    tmpDirs.push(dir);
    process.env.TALE_BROWSER_CTRL_DIR = dir;
    process.env.TALE_CDP_HOST = '127.0.0.1';
    process.env.TALE_CDP_PORT = String(aClosedPort());
    const r = await resetBrowser(200);
    expect(existsSync(join(dir, 'reset'))).toBe(true);
    expect(r.signalled).toBe(false);
  });
});
