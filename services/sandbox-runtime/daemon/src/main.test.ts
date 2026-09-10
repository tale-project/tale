// Drive runnerd over HTTP without Docker: the retired viewing surface must be
// gone while ordinary command execution still streams stdout and exit status.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';

const workspace = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-http-`));
const token = 'runnerd-http-test-token';
const previous = {
  workspace: process.env.TALE_WORKSPACE_ROOT,
  token: process.env.TALE_RUNNERD_TOKEN,
  browser: process.env.TALE_BROWSER_CDP,
};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.TALE_WORKSPACE_ROOT = workspace;
  process.env.TALE_RUNNERD_TOKEN = token;
  // An old deployment's leftover env cannot revive the retired stack.
  process.env.TALE_BROWSER_CDP = '1';
  ({ server } = await import('./main.ts'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('no HTTP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  for (const [name, value] of [
    ['TALE_WORKSPACE_ROOT', previous.workspace],
    ['TALE_RUNNERD_TOKEN', previous.token],
    ['TALE_BROWSER_CDP', previous.browser],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(workspace, { recursive: true, force: true });
});

const headers = { 'x-tale-runnerd-token': token };

describe('runnerd HTTP service', () => {
  test('rejects unauthenticated execution', async () => {
    const response = await fetch(`${baseUrl}/execs`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  test('removed browser controls and viewing tunnel return 404', async () => {
    for (const [method, path] of [
      ['GET', '/screencast'],
      ['POST', '/browser/restart'],
      ['POST', '/browser/reset'],
      ['POST', '/browser/close-pages'],
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
  });

  test('health describes process activity without viewer state', async () => {
    const response = await fetch(`${baseUrl}/healthz`, { headers });
    expect(await response.json()).toEqual({
      ok: true,
      bootedAtMs: expect.any(Number),
      lastActivityAtMs: expect.any(Number),
      liveExecs: 0,
    });
  });

  test('exec streams a real process without a managed-browser preflight', async () => {
    const response = await fetch(`${baseUrl}/execs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        execId: 'plain-command',
        command: ['/bin/sh', '-c', 'printf runnerd-ready'],
        cwd: workspace,
        timeoutMs: 5_000,
        stdoutMaxBytes: 10_000,
        stderrMaxBytes: 10_000,
      }),
    });
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain('"t":"start"');
    expect(stream).toContain(Buffer.from('runnerd-ready').toString('base64'));
    expect(stream).toContain('"exitCode":0');
    const status = await fetch(`${baseUrl}/execs/plain-command`, { headers });
    expect(await status.json()).toEqual({
      execId: 'plain-command',
      state: 'exited',
      exitCode: 0,
    });
  });
});
