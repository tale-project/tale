// Render the egress proxy's tinyproxy config through its real entrypoint.
// Paths move into a scratch directory and the daemons it supervises are
// stubs; the template, the variable handling and envsubst are the real ones
// (a stand-in that honours envsubst's SHELL-FORMAT where it is missing).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-egress-config-'));
const bin = join(root, 'bin');
const etc = join(root, 'etc');
const log = join(root, 'log');
mkdirSync(bin);
mkdirSync(etc);
mkdirSync(log);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const egressDir = resolve(import.meta.dir, '../../sandbox-egress');
writeFileSync(
  join(etc, 'tinyproxy.conf.template'),
  readFileSync(join(egressDir, 'tinyproxy.conf.template'), 'utf8'),
);
// The supervised daemons and the root-only chown exit at once; tinyproxy
// first says the open-file limit it was started with.
for (const name of ['dnsmasq', 'tail', 'chown'])
  writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const tinyproxyFiles = join(root, 'tinyproxy-nofile');
writeFileSync(
  join(bin, 'tinyproxy'),
  `#!/bin/sh\nulimit -n > '${tinyproxyFiles}'\nexit 0\n`,
  { mode: 0o755 },
);
const envsubst = Bun.which('envsubst');
if (envsubst !== null) symlinkSync(envsubst, join(bin, 'envsubst'));
else
  writeFileSync(
    join(bin, 'envsubst'),
    `#!${process.execPath}
const names = [...(process.argv[2] ?? '').matchAll(/\\$\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g)].map((m) => m[1]);
let text = await Bun.stdin.text();
for (const name of names) text = text.replaceAll('\${' + name + '}', process.env[name] ?? '');
process.stdout.write(text);
`,
    { mode: 0o755 },
  );
const entrypoint = readFileSync(join(egressDir, 'entrypoint.sh'), 'utf8')
  .replaceAll('/etc/tinyproxy', etc)
  .replaceAll('/var/log/tinyproxy', log)
  .replace('\nsleep 1\n', '\n');

/** Run the entrypoint; `before` runs first in the same shell (a lower
 * open-file limit, say). */
function boot(maxClients?: string, before = '') {
  rmSync(join(etc, 'tinyproxy.conf'), { force: true });
  rmSync(tinyproxyFiles, { force: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    SANDBOX_EGRESS_ALLOWLIST: '',
  };
  if (maxClients === undefined) delete env.SANDBOX_EGRESS_MAX_CLIENTS;
  else env.SANDBOX_EGRESS_MAX_CLIENTS = maxClients;
  const result = spawnSync('/bin/sh', ['-c', `${before}\n${entrypoint}`], {
    env,
    encoding: 'utf8',
  });
  let config: string | null = null;
  try {
    config = readFileSync(join(etc, 'tinyproxy.conf'), 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  return { result, config };
}

const directive = (config: string | null, name: string) =>
  config
    ?.split('\n')
    .filter((line) => line.startsWith(`${name} `))
    .map((line) => line.slice(name.length + 1));

describe('egress proxy connection limit', () => {
  test('serves 2000 connections at once unless told otherwise', () => {
    const { result, config } = boot();
    expect(result.status).toBe(0);
    expect(directive(config, 'MaxClients')).toEqual(['2000']);
    // The idle tunnel timeout stays as it was, and nothing is left unrendered.
    expect(directive(config, 'Timeout')).toEqual(['600']);
    expect(config).not.toContain('${');
    expect(config).toContain('# Open egress: no hostname filter');
  });

  test('takes the limit from SANDBOX_EGRESS_MAX_CLIENTS', () => {
    const { result, config } = boot('3500');
    expect(result.status).toBe(0);
    expect(directive(config, 'MaxClients')).toEqual(['3500']);
    expect(result.stdout).toContain('at most 3500 connections');
  });

  test.each(['lots', '0', '-5', '0100', '2000 '])(
    'refuses to start on a limit that is no whole number above 0 (%p)',
    (value) => {
      const { result, config } = boot(value);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('SANDBOX_EGRESS_MAX_CLIENTS');
      expect(config).toBeNull();
    },
  );

  test('raises its open-file limit to what the connections need, as far as the hard limit allows', () => {
    const hard = spawnSync('/bin/sh', ['-c', 'ulimit -H -n'], {
      encoding: 'utf8',
    }).stdout.trim();
    // 1000 connections need 2064 descriptors; a runtime's soft limit of 256
    // would hold about a hundred.
    const { result } = boot('1000', 'ulimit -S -n 256');
    expect(result.status).toBe(0);
    if (hard === 'unlimited' || Number(hard) >= 2064) {
      expect(result.stdout).toContain(
        'raised the open-file limit from 256 to 2064 for 1000 connections',
      );
      expect(readFileSync(tinyproxyFiles, 'utf8').trim()).toBe('2064');
      expect(result.stdout).not.toContain('WARN');
    }
  });

  test('leaves a limit that already holds the connections alone', () => {
    const { result } = boot('100', 'ulimit -S -n 1024');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('raised the open-file limit');
    expect(readFileSync(tinyproxyFiles, 'utf8').trim()).toBe('1024');
  });

  test('warns when the open-file limit cannot hold the connections', () => {
    const limit = spawnSync('/bin/sh', ['-c', 'ulimit -n'], {
      encoding: 'utf8',
    }).stdout.trim();
    const { result } = boot('100000000');
    expect(result.status).toBe(0);
    if (limit !== 'unlimited') {
      expect(result.stdout).toContain('raise its nofile ulimit');
    }
  });
});
