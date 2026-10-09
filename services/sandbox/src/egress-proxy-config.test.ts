// Render the egress proxy's tinyproxy config and supervise its daemons
// through its real entrypoint. Paths move into a scratch directory and the
// daemons it supervises are stubs; the template, the variable handling, the
// supervision and envsubst are the real ones (a stand-in that honours
// envsubst's SHELL-FORMAT where it is missing).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
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
mkdirSync(bin);
mkdirSync(etc);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const egressDir = resolve(import.meta.dir, '../../sandbox-egress');
writeFileSync(
  join(etc, 'tinyproxy.conf.template'),
  readFileSync(join(egressDir, 'tinyproxy.conf.template'), 'utf8'),
);
// The supervised daemons run until a TERM, note it in `events` and exit 0,
// as both real daemons do. dnsmasq first records its arguments, tinyproxy the
// open-file limit it was started with; once dnsmasq is up, tinyproxy asks the
// entrypoint to stop, as `docker stop` would, unless STUB_TINYPROXY_STAY is
// set.
// STUB_<DAEMON>_EXIT makes a daemon exit on its own at once with that status.
// A `tail` records that something ran it: the proxy logs to stdout, so
// nothing should poll a log file beside it.
const events = join(root, 'events');
const dnsmasqArgs = join(root, 'dnsmasq-args');
const tinyproxyFiles = join(root, 'tinyproxy-nofile');
const untilStopped = (name: string) =>
  `trap 'kill "$nap" 2>/dev/null; echo ${name} stopped >> "${events}"; exit 0' TERM`;
const idle = 'while :; do sleep 1 & nap=$!; wait "$nap"; done';
writeFileSync(
  join(bin, 'dnsmasq'),
  [
    '#!/bin/sh',
    untilStopped('dnsmasq'),
    `echo "$@" > '${dnsmasqArgs}'`,
    '[ -z "$STUB_DNSMASQ_EXIT" ] || exit "$STUB_DNSMASQ_EXIT"',
    idle,
    '',
  ].join('\n'),
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'tinyproxy'),
  [
    '#!/bin/sh',
    untilStopped('tinyproxy'),
    `ulimit -n > '${tinyproxyFiles}'`,
    '[ -z "$STUB_TINYPROXY_EXIT" ] || exit "$STUB_TINYPROXY_EXIT"',
    `while [ ! -e '${dnsmasqArgs}' ]; do sleep 1; done`,
    '[ -n "$STUB_TINYPROXY_STAY" ] || kill -TERM "$PPID"',
    idle,
    '',
  ].join('\n'),
  { mode: 0o755 },
);
const tailRuns = join(root, 'tail-runs');
writeFileSync(join(bin, 'tail'), `#!/bin/sh\necho "$@" >> '${tailRuns}'\n`, {
  mode: 0o755,
});
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
const entrypoint = readFileSync(
  join(egressDir, 'entrypoint.sh'),
  'utf8',
).replaceAll('/etc/tinyproxy', etc);

/** Run the entrypoint; `before` runs first in the same shell (a lower
 * open-file limit, say), and `stubs` steers the stand-in daemons. */
function boot(
  maxClients?: string,
  before = '',
  stubs: Record<string, string> = {},
) {
  for (const file of [
    join(etc, 'tinyproxy.conf'),
    tinyproxyFiles,
    dnsmasqArgs,
    events,
  ])
    rmSync(file, { force: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...stubs,
    PATH: `${bin}:/usr/bin:/bin`,
    SANDBOX_EGRESS_ALLOWLIST: '',
  };
  if (maxClients === undefined) delete env.SANDBOX_EGRESS_MAX_CLIENTS;
  else env.SANDBOX_EGRESS_MAX_CLIENTS = maxClients;
  const result = spawnSync('/bin/sh', ['-c', `${before}\n${entrypoint}`], {
    env,
    encoding: 'utf8',
    // A supervisor that never notices its daemons would hang the suite; the
    // TERM at the deadline takes the stop path instead.
    timeout: 20_000,
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

const stopped = () =>
  existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n') : [];

const directive = (config: string | null, name: string) =>
  config
    ?.split('\n')
    .filter((line) => line.startsWith(`${name} `))
    .map((line) => line.slice(name.length + 1));

describe('egress proxy logging', () => {
  test('tinyproxy logs to stdout, the container log, with no log file to poll', () => {
    const { result, config } = boot();
    expect(result.status).toBe(0);
    // With neither directive tinyproxy writes its log to stdout; a LogFile
    // grows unrotated in the container's writable layer.
    expect(directive(config, 'LogFile')).toEqual([]);
    expect(directive(config, 'Syslog')).toEqual([]);
    expect(existsSync(tailRuns)).toBe(false);
  });
});

describe('egress proxy supervision', () => {
  test("a stop request stops both daemons and exits with tinyproxy's status", () => {
    const { result } = boot();
    expect(result.status).toBe(0);
    expect(stopped().sort()).toEqual(['dnsmasq stopped', 'tinyproxy stopped']);
    expect(result.stdout).not.toContain('FATAL');
  });

  test('dnsmasq exiting on its own stops tinyproxy and the container with its status', () => {
    const { result } = boot(undefined, '', {
      STUB_DNSMASQ_EXIT: '3',
      STUB_TINYPROXY_STAY: '1',
    });
    expect(result.status).toBe(3);
    expect(result.stdout).toContain(
      'FATAL: dnsmasq exited with status 3; stopping the proxy so the container restarts with both',
    );
    expect(stopped()).toEqual(['tinyproxy stopped']);
  });

  test('tinyproxy exiting on its own stops dnsmasq and exits non-zero even on status 0', () => {
    const { result } = boot(undefined, '', { STUB_TINYPROXY_EXIT: '0' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FATAL: tinyproxy exited with status 0');
    expect(stopped()).toEqual(['dnsmasq stopped']);
  });

  test('dnsmasq caches 4096 names and answers the health probe name itself', () => {
    const { result } = boot();
    expect(result.status).toBe(0);
    const args = readFileSync(dnsmasqArgs, 'utf8').trim().split(' ');
    expect(args).toContain('--keep-in-foreground');
    expect(args).toContain('--cache-size=4096');
    expect(args).toContain(
      '--host-record=sandbox-egress-health.invalid,127.0.0.1',
    );
  });
});

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
    // Constrain only the child shell. An inherited unlimited hard limit
    // otherwise lets the entrypoint raise even a very large soft limit.
    const { result } = boot(
      '3500',
      'ulimit -S -n 4096 && ulimit -H -n 4096 || exit 1',
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "WARN: 3500 connections need about 7064 open files, more than this container's limit of 4096 allows; raise its nofile ulimit",
    );
    expect(readFileSync(tinyproxyFiles, 'utf8').trim()).toBe('4096');
  });
});
