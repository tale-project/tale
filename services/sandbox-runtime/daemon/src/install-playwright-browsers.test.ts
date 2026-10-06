import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tale-browser-installer-'));
const installer = resolve(
  import.meta.dir,
  '../../install-playwright-browsers.sh',
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the pinned Playwright browser installer', () => {
  function fixture(name: string, missingExecutable = false) {
    const root = join(dir, name);
    const bin = join(root, 'bin');
    const mcp = join(root, 'agents/lib/node_modules/@playwright/mcp');
    const cli = join(mcp, 'node_modules/playwright/cli.js');
    const core = join(mcp, 'node_modules/playwright-core');
    const browsers = join(root, 'browsers');
    const shell = join(browsers, 'chromium_headless_shell-1194');
    const ffmpeg = join(browsers, 'ffmpeg-1011');
    const executablePath = join(shell, 'chrome-linux/headless_shell');
    const manifest = join(root, 'metadata/browser.json');
    const trace = join(root, 'downloads.log');
    for (const path of [bin, dirname(cli), core, browsers])
      mkdirSync(path, { recursive: true });
    writeFileSync(
      join(mcp, 'package.json'),
      JSON.stringify({
        name: '@playwright/mcp',
        version: '0.0.41',
        exports: { './package.json': './package.json' },
      }),
    );
    writeFileSync(join(mcp, 'cli.js'), '// pinned MCP executable\n');
    writeFileSync(
      join(core, 'package.json'),
      JSON.stringify({
        name: 'playwright-core',
        exports: { './lib/server/registry/index': './registry.cjs' },
      }),
    );
    writeFileSync(
      join(core, 'registry.cjs'),
      [
        'exports.registryDirectory = ' + JSON.stringify(browsers) + ';',
        'exports.registry = { findExecutable(name) {',
        "if (name !== 'chromium-headless-shell') throw new Error('wrong executable');",
        'return { executablePath: () => ' +
          JSON.stringify(executablePath) +
          ' };',
        '} };',
      ].join('\n'),
    );
    const plan = [
      'browser: chromium-headless-shell version 141.0.7390.37',
      '  Install location: ' + shell,
      '  Download url: https://fixture.invalid/headless-shell.zip',
      '  Download fallback 1: https://fallback.invalid/headless-shell.zip',
      'browser: ffmpeg',
      '  Install location: ' + ffmpeg,
      '  Download url: https://fixture.invalid/ffmpeg.zip',
    ].join('\n');
    writeFileSync(
      cli,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'fs.writeFileSync(process.env.INSTALLER_FIXTURE_ARGS, JSON.stringify(process.argv.slice(2)));',
        'console.log(' + JSON.stringify(plan) + ');',
      ].join('\n'),
      { mode: 0o755 },
    );
    // Stand-ins exercise planning and executable validation without network
    // access or a browser download in the unit suite.
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" >> "$INSTALLER_FIXTURE_TRACE"',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-o" ]; then shift; : > "$1"; fi',
        '  shift',
        'done',
      ].join('\n'),
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'unzip'),
      [
        '#!/bin/sh',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-d" ]; then shift; destination="$1"; fi',
        '  shift',
        'done',
        'case "$destination" in',
        '  *chromium_headless_shell*)',
        '    mkdir -p "$destination/chrome-linux"',
        '    if [ "$INSTALLER_FIXTURE_MISSING" != "1" ]; then',
        '      printf "#!/bin/sh\\nexit 0\\n" > "$destination/chrome-linux/headless_shell"',
        '      chmod 755 "$destination/chrome-linux/headless_shell"',
        '    fi',
        '    ;;',
        'esac',
      ].join('\n'),
      { mode: 0o755 },
    );
    const args = join(root, 'args.json');
    const result = spawnSync('sh', [installer, cli, manifest], {
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        INSTALLER_FIXTURE_ARGS: args,
        INSTALLER_FIXTURE_TRACE: trace,
        INSTALLER_FIXTURE_MISSING: missingExecutable ? '1' : '0',
      },
      encoding: 'utf8',
    });
    return {
      result,
      args,
      trace,
      manifest,
      executablePath,
      mcp,
      browsers,
      shell,
      ffmpeg,
    };
  }

  test('installs only the bundled headless shell and records its executable and MCP identity', () => {
    const installed = fixture('complete');
    expect(installed.result.status).toBe(0);
    expect(JSON.parse(readFileSync(installed.args, 'utf8'))).toEqual([
      'install',
      '--dry-run',
      '--only-shell',
      'chromium',
    ]);
    const downloads = readFileSync(installed.trace, 'utf8');
    expect(downloads).toContain('https://fixture.invalid/headless-shell.zip');
    expect(downloads).toContain('https://fixture.invalid/ffmpeg.zip');
    expect(downloads).not.toContain('fallback.invalid');
    expect(existsSync(join(installed.shell, 'INSTALLATION_COMPLETE'))).toBe(
      true,
    );
    expect(existsSync(join(installed.ffmpeg, 'INSTALLATION_COMPLETE'))).toBe(
      true,
    );
    expect(existsSync(join(installed.browsers, 'chromium-1194'))).toBe(false);
    expect(JSON.parse(readFileSync(installed.manifest, 'utf8'))).toEqual({
      executablePath: installed.executablePath,
      server: realpathSync(join(installed.mcp, 'cli.js')),
      serverVersion: '0.0.41',
      browsersPath: installed.browsers,
    });
  });

  test('fails the build instead of recording a missing shell executable', () => {
    const installed = fixture('missing', true);
    expect(installed.result.status).not.toBe(0);
    expect(existsSync(installed.manifest)).toBe(false);
  });
});
