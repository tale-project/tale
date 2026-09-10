// The headless launcher still bridges proxy settings into Playwright's flags
// after removal of the managed browser/CDP viewing mode.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tale-playwright-shim-'));
const shim = resolve(import.meta.dir, '../../tale-playwright-mcp');
writeFileSync(
  join(dir, 'mcp-server-playwright'),
  '#!/bin/sh\nprintf "%s\\n" "$PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK" "$@"\n',
  { mode: 0o755 },
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function launch(proxy: string, bypass: string): string[] {
  const result = spawnSync(
    '/bin/sh',
    [shim, '--headless', '--browser', 'chromium'],
    {
      env: { ...process.env, PATH: dir, HTTPS_PROXY: proxy, NO_PROXY: bypass },
      encoding: 'utf8',
    },
  );
  expect(result.status).toBe(0);
  return result.stdout.trim().split('\n');
}

describe('headless Playwright MCP launcher', () => {
  test('preserves headless launch flags and appends the sandbox proxy', () => {
    expect(launch('http://sandbox-egress:3128', '127.0.0.1,localhost')).toEqual(
      [
        '1',
        '--headless',
        '--browser',
        'chromium',
        '--proxy-server',
        'http://sandbox-egress:3128',
        '--proxy-bypass',
        '127.0.0.1,localhost',
      ],
    );
  });
  test('does not invent proxy arguments when no proxy is configured', () => {
    expect(launch('', '')).toEqual([
      '1',
      '--headless',
      '--browser',
      'chromium',
    ]);
  });
});
