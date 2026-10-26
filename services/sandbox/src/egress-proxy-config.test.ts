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
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { REGISTRY_HOSTS } from './backend/incus/incus-registry-caches.ts';

const root = mkdtempSync(join(tmpdir(), 'tale-egress-config-'));
const bin = join(root, 'bin');
const etc = join(root, 'etc');
// The image's /etc/sandbox-egress: the outbound-proxy reader and the squid
// hop's template.
const hopEtc = join(root, 'hop');
mkdirSync(bin);
mkdirSync(etc);
mkdirSync(hopEtc);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const egressDir = resolve(import.meta.dir, '../../sandbox-egress');
writeFileSync(
  join(etc, 'tinyproxy.conf.template'),
  readFileSync(join(egressDir, 'tinyproxy.conf.template'), 'utf8'),
);
for (const name of ['outbound-proxies.awk', 'squid.conf.template']) {
  writeFileSync(
    join(hopEtc, name),
    readFileSync(join(egressDir, name), 'utf8'),
  );
}
// The supervised daemons run until a TERM, note it in `events` and exit 0,
// as the real daemons do. dnsmasq and squid first record their arguments,
// tinyproxy the open-file limit it was started with; once the others are up,
// tinyproxy asks the entrypoint to stop, as `docker stop` would, unless
// STUB_TINYPROXY_STAY is set.
// Every stub acknowledges startup after installing its TERM trap. Controlled
// exits and the parent stop wait for every acknowledgement (squid's only when
// STUB_SQUID_EXPECTED says the hop starts), so a peer can record its shutdown
// even when its initialization was scheduled later.
// STUB_<DAEMON>_EXIT makes a daemon exit on its own with that status.
// A `tail` records that something ran it: the proxy logs to stdout, so
// nothing should poll a log file beside it.
const events = join(root, 'events');
const dnsmasqArgs = join(root, 'dnsmasq-args');
const squidArgs = join(root, 'squid-args');
const tinyproxyFiles = join(root, 'tinyproxy-nofile');
const untilStopped = (name: string) =>
  `trap 'trap "" TERM; kill "$nap" 2>/dev/null; echo ${name} stopped >> "${events}"; exit 0' TERM`;
const ready = `while [ ! -e '${dnsmasqArgs}' ] || [ ! -e '${tinyproxyFiles}' ] || { [ -n "$STUB_SQUID_EXPECTED" ] && [ ! -e '${squidArgs}' ]; }; do sleep 0.01; done`;
const idle = 'while :; do sleep 1 & nap=$!; wait "$nap"; done';
writeFileSync(
  join(bin, 'dnsmasq'),
  [
    '#!/bin/sh',
    untilStopped('dnsmasq'),
    `echo "$@" > '${dnsmasqArgs}'`,
    ready,
    '[ -z "$STUB_DNSMASQ_EXIT" ] || exit "$STUB_DNSMASQ_EXIT"',
    idle,
    '',
  ].join('\n'),
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'squid'),
  [
    '#!/bin/sh',
    untilStopped('squid'),
    `echo "$@" > '${squidArgs}'`,
    ready,
    '[ -z "$STUB_SQUID_EXIT" ] || exit "$STUB_SQUID_EXIT"',
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
    ready,
    '[ -z "$STUB_TINYPROXY_EXIT" ] || exit "$STUB_TINYPROXY_EXIT"',
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
const entrypoint = readFileSync(join(egressDir, 'entrypoint.sh'), 'utf8')
  .replaceAll('/etc/tinyproxy', etc)
  .replaceAll('/etc/sandbox-egress', hopEtc);

/** Run the entrypoint; `before` runs first in the same shell (a lower
 * open-file limit, say), and `stubs` steers the stand-in daemons. */
function boot(
  maxClients?: string,
  before = '',
  stubs: Record<string, string> = {},
) {
  for (const file of [
    join(etc, 'tinyproxy.conf'),
    join(hopEtc, 'squid.conf'),
    tinyproxyFiles,
    dnsmasqArgs,
    squidArgs,
    events,
    join(etc, 'allowlist'),
    join(etc, 'denylist'),
  ])
    rmSync(file, { force: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Neither list is the host's, and no outbound proxy, unless a case sets
    // one.
    SANDBOX_EGRESS_ALLOWLIST: '',
    SANDBOX_EGRESS_DENIED_HOSTS: '',
    OUTBOUND_PROXY_URLS: '',
    ...stubs,
    PATH: `${bin}:/usr/bin:/bin`,
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
      'FATAL: dnsmasq exited with status 3; stopping the proxy so the container restarts whole',
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

// The hosts the proxy refuses, whatever else it serves: the registries a
// node's caches replace.
describe('egress proxy host deny-list', () => {
  // The registries the spawner's caches replace, which the spawner's own list
  // names: the proxy must take exactly these.
  const REGISTRIES = [...REGISTRY_HOSTS.npm, ...REGISTRY_HOSTS.pypi];
  const denylist = () => readFileSync(join(etc, 'denylist'), 'utf8');
  const dnsmasqAddresses = () =>
    readFileSync(dnsmasqArgs, 'utf8')
      .trim()
      .split(' ')
      .filter((arg) => arg.startsWith('--address='));

  /** Which of these names the rendered deny-list matches, as tinyproxy would
   * match a host: an extended regular expression, case-insensitive. */
  function refused(names: string[]): string[] {
    return names.filter(
      (name) =>
        spawnSync(
          'grep',
          ['-E', '-i', '-q', '-f', join(etc, 'denylist'), '--', '-'],
          { input: `${name}\n` },
        ).status === 0,
    );
  }

  test('unset, the proxy is open as before: no filter, no list, no refused name', () => {
    const { result, config } = boot();
    expect(result.status).toBe(0);
    expect(config).toContain('# Open egress: no hostname filter');
    expect(directive(config, 'Filter')).toEqual([]);
    expect(directive(config, 'FilterDefaultDeny')).toEqual([]);
    expect(existsSync(join(etc, 'denylist'))).toBe(false);
    expect(dnsmasqAddresses()).toEqual([]);
    expect(result.stdout).toContain('egress mode: open,');
  });

  test('refuses the named hosts and leaves everything else open', () => {
    const { result, config } = boot(undefined, '', {
      SANDBOX_EGRESS_DENIED_HOSTS: REGISTRIES.join(','),
    });
    expect(result.status).toBe(0);
    expect(directive(config, 'FilterDefaultDeny')).toEqual(['No']);
    expect(directive(config, 'FilterExtended')).toEqual(['Yes']);
    expect(directive(config, 'FilterURLs')).toEqual(['Off']);
    expect(directive(config, 'Filter')).toEqual([`"${etc}/denylist"`]);
    expect(config).not.toContain('${');
    expect(denylist()).toBe(
      `${REGISTRIES.map((host) => `(^|\\.)${host.replaceAll('.', '\\.')}\\.?$`).join('\n')}\n`,
    );
    expect(denylist().split('\n')[0]).toBe(
      '(^|\\.)registry\\.npmjs\\.org\\.?$',
    );
    expect(result.stdout).toContain('egress mode: denylist,');
    for (const host of REGISTRIES) {
      expect(result.stdout).toContain(`  ${host}\n`);
    }
    // The rest of the config is the open proxy's own.
    expect(directive(config, 'ConnectPort')).toEqual(['443', '80']);
    expect(directive(config, 'MaxClients')).toEqual(['2000']);
  });

  test('a host and its subdomains are refused, and a name that only looks like one is not', () => {
    boot(undefined, '', { SANDBOX_EGRESS_DENIED_HOSTS: REGISTRIES.join(',') });
    expect(
      refused([
        'registry.npmjs.org',
        'REGISTRY.NPMJS.ORG',
        'a.registry.npmjs.org',
        // The fully qualified form resolves to the same address, and a client
        // may write it: tinyproxy matches the host as it was written.
        'registry.npmjs.org.',
        'a.registry.npmjs.org.',
        'pypi.org',
        'PyPI.org.',
        'files.pythonhosted.org',
        'cdn.files.pythonhosted.org',
      ]),
    ).toEqual([
      'registry.npmjs.org',
      'REGISTRY.NPMJS.ORG',
      'a.registry.npmjs.org',
      'registry.npmjs.org.',
      'a.registry.npmjs.org.',
      'pypi.org',
      'PyPI.org.',
      'files.pythonhosted.org',
      'cdn.files.pythonhosted.org',
    ]);
    expect(
      refused([
        'xregistry.npmjs.org',
        'registry-npmjs.org',
        'registry.npmjs.org.example.test',
        'registry.npmjs.org..',
        'notpypi.org',
        'pypi.org.example.test',
        'npmjs.org',
        'github.com',
        'example.com',
      ]),
    ).toEqual([]);
  });

  test('the DNS forwarder answers none of them an address, subdomains included', () => {
    const { result } = boot(undefined, '', {
      SANDBOX_EGRESS_DENIED_HOSTS: REGISTRIES.join(','),
    });
    expect(result.status).toBe(0);
    expect(dnsmasqAddresses()).toEqual(
      REGISTRIES.map((host) => `--address=/${host}/`),
    );
    // The forwarder keeps what it had: the cache and the health probe's name.
    const args = readFileSync(dnsmasqArgs, 'utf8').trim().split(' ');
    expect(args).toContain('--cache-size=4096');
    expect(args).toContain(
      '--host-record=sandbox-egress-health.invalid,127.0.0.1',
    );
  });

  test('takes commas, bars and spaces, any case, and a trailing separator', () => {
    const { result } = boot(undefined, '', {
      SANDBOX_EGRESS_DENIED_HOSTS:
        ' Pypi.org|files.pythonhosted.org, registry.npmjs.org  ,',
    });
    expect(result.status).toBe(0);
    expect(denylist().trim().split('\n')).toEqual([
      '(^|\\.)pypi\\.org\\.?$',
      '(^|\\.)files\\.pythonhosted\\.org\\.?$',
      '(^|\\.)registry\\.npmjs\\.org\\.?$',
    ]);
  });

  test('never expands a pattern of the shell in the list into the names of files', () => {
    // Run from the root, where `*` would name directories that read as hosts.
    const { result } = boot(undefined, 'cd /', {
      SANDBOX_EGRESS_DENIED_HOSTS: '*',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'FATAL: SANDBOX_EGRESS_DENIED_HOSTS must be host names',
    );
    expect(result.stdout).toContain("got '*'");
  });

  test.each([
    'registry.npmjs.org/x',
    '^pypi\\.org$',
    'https://pypi.org',
    'pypi.org:443',
    'localhost',
    '.example.com',
    'example.com.',
    '-a.example.com',
    'a-.example.com',
    'a.-b.example.com',
    'a..example.com',
    'a$(reboot).example.com',
    'a;b.example.com',
    '(^|.)pypi.org',
    'ex ample',
  ])('stops the start on %p, which is no plain host name', (value) => {
    const { result, config } = boot(undefined, '', {
      SANDBOX_EGRESS_DENIED_HOSTS: value,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FATAL: SANDBOX_EGRESS_DENIED_HOSTS');
    expect(config).toBeNull();
    expect(existsSync(dnsmasqArgs)).toBe(false);
  });

  test('stops the start on a list that names no host', () => {
    for (const value of [',', ' | , ']) {
      const { result, config } = boot(undefined, '', {
        SANDBOX_EGRESS_DENIED_HOSTS: value,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('names no host');
      expect(config).toBeNull();
    }
  });

  test('stops the start beside an allow-list, which already refuses what it does not name', () => {
    const { result, config } = boot(undefined, '', {
      SANDBOX_EGRESS_ALLOWLIST: '^github\\.com$',
      SANDBOX_EGRESS_DENIED_HOSTS: 'pypi.org',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'SANDBOX_EGRESS_ALLOWLIST and SANDBOX_EGRESS_DENIED_HOSTS are both set',
    );
    expect(config).toBeNull();
  });

  test('an allow-list alone is rendered as it was', () => {
    const { result, config } = boot(undefined, '', {
      SANDBOX_EGRESS_ALLOWLIST: '^github\\.com$|^pypi\\.org$',
    });
    expect(result.status).toBe(0);
    expect(directive(config, 'FilterDefaultDeny')).toEqual(['Yes']);
    expect(readFileSync(join(etc, 'allowlist'), 'utf8')).toBe(
      '^github\\.com$\n^pypi\\.org$\n',
    );
    expect(existsSync(join(etc, 'denylist'))).toBe(false);
    expect(dnsmasqAddresses()).toEqual([]);
  });
});

// OUTBOUND_PROXY_URLS: the proxies sessions' traffic leaves through, in turn,
// by way of a squid hop tinyproxy hands every request to.
describe('egress proxy outbound proxies', () => {
  const POOL = 'http://alice:s3cret@203.0.113.7:8080, http://P.Example';
  const squidConfig = () => {
    const path = join(hopEtc, 'squid.conf');
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };

  test('unset, tinyproxy connects to destinations itself and no hop starts', () => {
    for (const value of ['', ' , ']) {
      const { result, config } = boot(undefined, '', {
        OUTBOUND_PROXY_URLS: value,
      });
      expect(result.status).toBe(0);
      expect(directive(config, 'Upstream')).toEqual([]);
      expect(config).toContain(
        '# No upstream: OUTBOUND_PROXY_URLS lists no proxy.',
      );
      expect(config).not.toContain('${');
      expect(squidConfig()).toBeNull();
      expect(existsSync(squidArgs)).toBe(false);
      expect(stopped().sort()).toEqual([
        'dnsmasq stopped',
        'tinyproxy stopped',
      ]);
    }
  });

  test('hands every request to the squid hop, which takes the proxies in turn', () => {
    const { result, config } = boot(undefined, '', {
      OUTBOUND_PROXY_URLS: POOL,
      STUB_SQUID_EXPECTED: '1',
    });
    expect(result.status).toBe(0);
    expect(directive(config, 'Upstream')).toEqual(['http 127.0.0.1:3129']);
    expect(config).not.toContain('${');
    const squid = squidConfig();
    expect(squid).not.toContain('${');
    expect(
      squid?.split('\n').filter((line) => line.startsWith('cache_peer ')),
    ).toEqual([
      'cache_peer 203.0.113.7 parent 8080 0 no-query no-digest round-robin connect-timeout=10 connect-fail-limit=2 name=outbound-1 login=alice:s3cret',
      'cache_peer p.example parent 80 0 no-query no-digest round-robin connect-timeout=10 connect-fail-limit=2 name=outbound-2',
    ]);
    // Never straight to a destination, and only tinyproxy on loopback.
    expect(squid).toContain('\nnever_direct allow all\n');
    expect(squid).toContain('\nhttp_port 127.0.0.1:3129\n');
    expect(squid).toContain('\naccess_log none\n');
    // The cache manager (which shows the passwords) and the destinations the
    // egress firewall no longer sees are refused before tinyproxy is let in.
    const access = squid
      ?.split('\n')
      .filter((line) => line.startsWith('http_access '));
    expect(access).toEqual([
      'http_access deny manager',
      'http_access deny ipv6_literal',
      'http_access deny to_private',
      'http_access deny !resolvable',
      'http_access allow hop',
      'http_access deny all',
    ]);
    expect(squid).toContain('\nacl resolvable dst all\n');
    expect(squid).toContain('\nacl ipv6_literal dstdom_regex -n :\n');
    expect(squid).toContain('\ncachemgr_passwd disable all\n');
    expect(squid).toMatch(
      /\nacl to_private dst 0\.0\.0\.0\/8 10\.0\.0\.0\/8 127\.0\.0\.0\/8 169\.254\.0\.0\/16 172\.16\.0\.0\/12 192\.168\.0\.0\/16 ::1 fc00::\/7 fe80::\/10\n/,
    );
    // The passwords are in the squid config alone, which only root reads.
    expect(statSync(join(hopEtc, 'squid.conf')).mode & 0o777).toBe(0o600);
    expect(readFileSync(squidArgs, 'utf8').trim()).toBe(
      `-N -d 1 -f ${hopEtc}/squid.conf`,
    );
    expect(result.stdout).toContain('  http://203.0.113.7:8080\n');
    expect(result.stdout).toContain('  http://p.example:80\n');
    expect(result.stdout).not.toContain('s3cret');
    expect(result.stdout).not.toContain('alice');
    // A stop reaches the hop too.
    expect(stopped().sort()).toEqual([
      'dnsmasq stopped',
      'squid stopped',
      'tinyproxy stopped',
    ]);
  });

  test('squid exiting on its own stops the others and the container with its status', () => {
    const { result } = boot(undefined, '', {
      OUTBOUND_PROXY_URLS: POOL,
      STUB_SQUID_EXPECTED: '1',
      STUB_SQUID_EXIT: '4',
      STUB_TINYPROXY_STAY: '1',
    });
    expect(result.status).toBe(4);
    expect(result.stdout).toContain(
      'FATAL: squid exited with status 4; stopping the proxy so the container restarts whole',
    );
    expect(stopped().sort()).toEqual(['dnsmasq stopped', 'tinyproxy stopped']);
  });

  test('stops the start on a malformed entry, naming its position and never its text', () => {
    const { result, config } = boot(undefined, '', {
      OUTBOUND_PROXY_URLS: 'http://p.example, https://alice:s3cret@q.example',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'FATAL: OUTBOUND_PROXY_URLS entry 2 is not an http:// proxy URL (expected http://[user:password@]host[:port])',
    );
    expect(result.stdout).not.toContain('s3cret');
    expect(config).toBeNull();
    expect(squidConfig()).toBeNull();
    expect(existsSync(dnsmasqArgs)).toBe(false);
    expect(existsSync(squidArgs)).toBe(false);
  });
});
