import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverModule = path.resolve('src/server/index.ts');
const reportingModule = path.resolve('src/monitoring/server.ts');
const children: ChildProcess[] = [];
let directory: string;

async function start(
  enabled: boolean,
): Promise<{ app: string; ingest: string }> {
  const script = `
import { startReactServer, defaultReactServerSecurityHeaders } from ${JSON.stringify(serverModule)};
import { initServerMonitoring } from ${JSON.stringify(reportingModule)};
let events = [];
let monitoring;
const ingest = Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req){
  if(new URL(req.url).pathname==='/events'){await monitoring.flush();return Response.json(events);}
  events.push(await req.text());return Response.json({});
}});
monitoring=initServerMonitoring({dsn:${enabled}?'http://public@127.0.0.1:'+ingest.port+'/42':undefined,service:'tale-web',release:'test-</script><script>unsafe</script>'});
const server=startReactServer({port:0,hostname:'127.0.0.1',distDir:${JSON.stringify(directory)},logPrefix:'monitoring-test',monitoring:monitoring.config,reportError:monitoring.capture,securityHeaders:defaultReactServerSecurityHeaders,
  extraRoutes(req,url){if(url.pathname==='/boom')throw new Error('PRIVATE_FORM_BODY');return null;},
  artifacts:{async handle(req){if(new URL(req.url).pathname==='/artifact')throw new Error('PRIVATE_ARTIFACT_PATH');return null;}}
});
console.log('READY '+server.port+' '+ingest.port);
`;
  const child = spawn('bun', ['--eval', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`Bun server did not start: ${output}`)),
      20_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /READY (\d+) (\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve({
          app: `http://127.0.0.1:${match[1]}`,
          ingest: `http://127.0.0.1:${match[2]}`,
        });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bun exited ${code}: ${output}`));
    });
  });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'tale-site-monitoring-'));
  writeFileSync(
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- directory is a test-owned mkdtemp path; this argument is a file path, not HTML.
    path.join(directory, 'index.html'),
    '<!doctype html><html><head><title>Test</title><script>document.documentElement.dataset.theme="light"</script></head><body>Test page</body></html>',
  );
});
afterAll(() => {
  for (const child of children) child.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe('Bun content-site reporting', () => {
  it('injects escaped runtime metadata, keeps strict CSP and reports server failures over HTTP', async () => {
    const { app, ingest } = await start(true);
    const page = await fetch(`${app}/en`, {
      signal: AbortSignal.timeout(5000),
    });
    const html = await page.text();
    expect(html).toContain('id="tale-monitoring" type="application/json"');
    expect(html).toContain('test-\\u003c/script\\u003e');
    expect(html).not.toContain('<script>unsafe</script>');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const csp = page.headers.get('content-security-policy');
    expect(csp).toContain(`connect-src 'self' ${ingest}`);
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    const failed = await fetch(`${app}/boom?email=PRIVATE_EMAIL`, {
      headers: { Authorization: 'Bearer PRIVATE_TOKEN' },
    });
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('Internal Server Error');
    expect((await fetch(`${app}/artifact`)).status).toBe(500);
    const wire = await (
      await fetch(`${ingest}/events`, { signal: AbortSignal.timeout(5000) })
    ).text();
    expect(wire).toContain('tale-web');
    expect(wire).toContain('Application error (details omitted)');
    expect(wire).not.toContain('PRIVATE_');
    expect(wire).not.toContain('Authorization');
    expect(wire).not.toContain('node_modules');
    expect(
      (await fetch(`${app}/api/health`)).headers.get('content-type'),
    ).toContain('application/json');
  }, 20000);

  it('omits SDK traffic, runtime metadata and external CSP origins when disabled', async () => {
    const { app, ingest } = await start(false);
    const page = await fetch(`${app}/en`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(await page.text()).not.toContain('tale-monitoring');
    expect(page.headers.get('content-security-policy')).toContain(
      "connect-src 'self';",
    );
    expect((await fetch(`${app}/boom`)).status).toBe(500);
    expect(await (await fetch(`${ingest}/events`)).json()).toEqual([]);
  });
});
