// The whole server over the real browser, for the tests of the real-browser
// lane: `startServer` as `server.ts` calls it (HTTP API and MCP endpoint),
// with the real `CamoufoxBackend` (headless) and a scripted exit-IP check
// (`FakeExitIpChecker`: the proxies are on this host, and the GeoIP database,
// which is offline, knows the addresses the test says they exit through).
//
//     const server = await startRealServer();
//     afterAll(() => server.stop());
//
//     await server.call('POST', '/api/proxies', { proxy: proxy.url });
//     const response = await server.call('POST', '/api/sessions', { name: 'a' });
//
// The data directory (and the built page, which is one blank file here) live in
// a temporary directory that `stop()` removes, unless the caller brings its own
// `root` (a second server on the data of the first).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../config.ts';
import { startServer } from '../main.ts';
import type { RunningServer } from '../main.ts';
import { FakeExitIpChecker } from './fake-exit-ip.ts';
import { RecordingBackend } from './real-browser.ts';
import type { RecordingBackendOptions } from './real-browser.ts';

export interface RealServerOptions extends RecordingBackendOptions {
  /**
   * The directory that holds `data/` and `dist/`. Default: a new temporary
   * directory, removed by `stop()`. One that is given is kept.
   */
  root?: string;
}

export interface RealServer {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  readonly port: number;
  readonly root: string;
  readonly dataDir: string;
  readonly backend: RecordingBackend;
  readonly checker: FakeExitIpChecker;
  readonly running: RunningServer;
  /** The profile directory of a session. */
  profileDir(sessionId: number): string;
  /** A request of the API (or of `/mcp`), with a JSON body if one is given. */
  call(method: string, path: string, body?: unknown): Promise<Response>;
  /** Stops the server: the port is released and every browser closed. */
  stop(): Promise<void>;
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) throw new Error('the probe has no port');
  return port;
}

export async function startRealServer(
  options: RealServerOptions = {},
): Promise<RealServer> {
  const given = options.root;
  const root = given ?? mkdtempSync(join(tmpdir(), 'sm-stack-'));
  const dist = join(root, 'dist');
  const dataDir = join(root, 'data');
  mkdirSync(dist, { recursive: true });
  // (One inline script: else the server says it found none to protect.)
  writeFileSync(
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- `dist` is a path in this run's own temp directory; the argument is a file name, not HTML
    join(dist, 'index.html'),
    '<!doctype html><title>session manager</title><script>void 0;</script>',
  );
  const port = await freePort();
  const config = loadConfig(
    { PORT: String(port), SESSION_MANAGER_DATA_DIR: dataDir },
    { distDir: dist },
  );
  const backend = new RecordingBackend({
    blockWebrtc: options.blockWebrtc,
    prefs: options.prefs,
  });
  const checker = new FakeExitIpChecker();
  let running: RunningServer;
  try {
    running = startServer(config, { backend, checker });
  } catch (error) {
    if (given === undefined) rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const origin = `http://127.0.0.1:${port}`;
  let stopped: Promise<void> | undefined;
  return {
    origin,
    port,
    root,
    dataDir,
    backend,
    checker,
    running,
    profileDir: (sessionId) => join(dataDir, 'profiles', String(sessionId)),
    call(method, path, body) {
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      return fetch(`${origin}${path}`, init);
    },
    stop() {
      stopped ??= (async () => {
        try {
          await running.stop();
        } finally {
          if (given === undefined) {
            rmSync(root, { recursive: true, force: true });
          }
        }
      })();
      return stopped;
    },
  };
}
