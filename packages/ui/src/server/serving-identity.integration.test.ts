import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { bunServers, serverModule } from '@/tests/utils/site-server';

const servers = bunServers();
let directory: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'tale-serving-identity-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html>fixture');
});
afterAll(() => {
  servers.stop();
  rmSync(directory, { recursive: true, force: true });
});

async function start(custom = false) {
  const [origin] = await servers.start(`
import { startReactServer } from ${JSON.stringify(serverModule)};
process.env.TALE_VERSION = '1.2.3';
const server = startReactServer({
  port: 0, hostname: '127.0.0.1', distDir: ${JSON.stringify(directory)},
  logPrefix: 'web', servingService: 'web', localeRouting: 'none',
  ${custom ? "buildHealthResponse: () => Response.json({status:'ok',version:'1.2.3',checks:{forms:'ok'}})," : ''}
});
console.log('READY ' + server.port);
`);
  return origin;
}

it('distinguishes actual same-version server processes while retaining health bodies', async () => {
  const first = await start();
  const second = await start();
  const read = (origin: string) =>
    fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
  const a = await read(first);
  const b = await read(second);
  const identity = a.headers.get('Tale-Serving-Identity');
  expect(identity).toMatch(
    /^v1;service=web;instance=[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(b.headers.get('Tale-Serving-Identity')).not.toBe(identity);
  expect((await read(first)).headers.get('Tale-Serving-Identity')).toBe(
    identity,
  );
  expect(a.headers.get('cache-control')).toBe('no-store');
  expect(await a.json()).toEqual({ status: 'ok', version: '1.2.3' });
  expect(await b.json()).toEqual({ status: 'ok', version: '1.2.3' });
});

it('keeps custom web health checks and adds the same process identity', async () => {
  const response = await fetch(`${await start(true)}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  expect(response.headers.get('Tale-Serving-Identity')).toMatch(
    /^v1;service=web;instance=/,
  );
  expect(await response.json()).toEqual({
    status: 'ok',
    version: '1.2.3',
    checks: { forms: 'ok' },
  });
});
