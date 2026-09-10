// Run the real entrypoint helpers against fake buildx/netfilter tools. A
// resumed HOME must not select its legacy global builder or become a router.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-build-startup-'));
const log = join(root, 'calls');
const bin = join(root, 'bin');
mkdirSync(bin);
const ipv6 = join(root, 'ipv6');
for (const profile of ['all', 'default', 'eth0']) {
  mkdirSync(join(ipv6, `conf/${profile}`), { recursive: true });
  writeFileSync(join(ipv6, `conf/${profile}/disable_ipv6`), '0');
}
writeFileSync(
  join(bin, 'setpriv'),
  `#!/bin/sh
while [ "$1" != "--" ]; do shift; done
shift
exec "$@"
`,
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'docker'),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$TALE_BUILD_TEST_LOG"
case "$*" in
  'buildx inspect tale-shared') exit 0 ;;
  'buildx inspect '*) [ "$TALE_BUILD_TEST_REUSE" = '1' ] ;;
  'buildx create '*) [ "$TALE_BUILD_TEST_CREATE_FAIL" != '1' ] ;;
  *) exit 1 ;;
esac
`,
  { mode: 0o755 },
);
const firewall = `#!/bin/sh
name="\${0##*/}"
printf '%s %s\\n' "$name" "$*" >> "$TALE_BUILD_TEST_LOG"
[ "$name $*" != "$TALE_BUILD_TEST_FIREWALL_FAIL" ]
`;
for (const name of ['iptables', 'ip6tables'])
  writeFileSync(join(bin, name), firewall, { mode: 0o755 });
const entrypoint = readFileSync(
  resolve(import.meta.dir, '../../entrypoint.sh'),
  'utf8',
);
const helpers = entrypoint
  .slice(0, entrypoint.indexOf('# K8s transparent-egress native sidecar.'))
  .replaceAll('/proc/sys/net/ipv6', ipv6)
  .replaceAll('/var/log/buildx-create.log', join(root, 'buildx-create.log'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const endpoint = 'tcp://tale-buildkitd-0123456789abcdef01234567:1234';
const builder = `tale-build-${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;

function run(command: string, env: Record<string, string> = {}) {
  writeFileSync(log, '');
  for (const profile of ['all', 'default', 'eth0']) {
    writeFileSync(
      join(ipv6, `conf/${profile}/disable_ipv6`),
      profile === 'eth0'
        ? (env.TALE_BUILD_TEST_INTERFACE_DISABLED ?? '0')
        : (env.TALE_BUILD_TEST_IPV6_DISABLED ?? '0'),
    );
  }
  const result = spawnSync('/bin/sh', ['-c', `${helpers}\n${command}`], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      TALE_BUILDKITD_ENDPOINT: endpoint,
      TALE_BUILD_TEST_LOG: log,
      BUILDX_BUILDER: 'tale-shared',
      TALE_BUILD_TEST_REUSE: '0',
      TALE_BUILD_TEST_CREATE_FAIL: '0',
      TALE_BUILD_TEST_FIREWALL_FAIL: '',
      ...env,
    },
    encoding: 'utf8',
  });
  return { result, calls: readFileSync(log, 'utf8').trim().split('\n') };
}

const select =
  'setup_shared_buildx_builder\nprintf "SELECTED=%s\\n" "$BUILDX_BUILDER"';
const protect = `_IPTABLES='${join(bin, 'iptables')}'\n_IP6TABLES='${join(bin, 'ip6tables')}'\nprotect_shared_cache_network\nprintf 'GUARDED\\n'`;

describe('shared build cache startup', () => {
  test('creates an endpoint-specific builder instead of reusing the legacy global builder', () => {
    const { result, calls } = run(select);
    expect(result.status).toBe(0);
    expect(calls).toEqual([
      `buildx inspect ${builder}`,
      `buildx create --name ${builder} --driver remote ${endpoint}`,
    ]);
    expect(result.stdout).toContain(`SELECTED=${builder}`);
  });
  test('reuses the same org endpoint builder on resume', () => {
    const { result, calls } = run(select, { TALE_BUILD_TEST_REUSE: '1' });
    expect(result.status).toBe(0);
    expect(calls).toEqual([`buildx inspect ${builder}`]);
    expect(result.stdout).toContain(`SELECTED=${builder}`);
  });
  test('failed setup explicitly selects the local daemon, never inherited tale-shared', () => {
    const { result } = run(select, { TALE_BUILD_TEST_CREATE_FAIL: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SELECTED=default');
  });
  test('blocks unsolicited forwarded traffic on outer interfaces in both address families', () => {
    const { result, calls } = run(protect);
    expect(result.status).toBe(0);
    for (const family of ['iptables', 'ip6tables']) {
      expect(calls).toContain(
        `${family} -I FORWARD 1 -i eth+ -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP`,
      );
    }
    expect(result.stdout).toContain('GUARDED');
  });
  test('refuses startup if either network guard fails, even with the dev firewall opt-out', () => {
    for (const family of ['iptables', 'ip6tables']) {
      const { result } = run(protect, {
        TALE_SKIP_SSRF_FIREWALL: '1',
        TALE_BUILD_TEST_FIREWALL_FAIL: `${family} -I FORWARD 1 -i eth+ -m conntrack ! --ctstate ESTABLISHED,RELATED -j DROP`,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('GUARDED');
    }
  });
  test('no IPv6 netfilter is acceptable only when every interface and defaults disable IPv6', () => {
    const disabled = run(protect, {
      TALE_BUILD_TEST_FIREWALL_FAIL: 'ip6tables -L FORWARD',
      TALE_BUILD_TEST_IPV6_DISABLED: '1',
      TALE_BUILD_TEST_INTERFACE_DISABLED: '1',
    });
    expect(disabled.result.status).toBe(0);
    expect(disabled.result.stdout).toContain('GUARDED');
    const enabledInterface = run(protect, {
      TALE_BUILD_TEST_FIREWALL_FAIL: 'ip6tables -L FORWARD',
      TALE_BUILD_TEST_IPV6_DISABLED: '1',
      TALE_BUILD_TEST_INTERFACE_DISABLED: '0',
    });
    expect(enabledInterface.result.status).toBe(1);
    expect(enabledInterface.result.stdout).not.toContain('GUARDED');
  });

  test('without shared cache there are no extra network guard calls', () => {
    const { result, calls } = run(protect, { TALE_BUILDKITD_ENDPOINT: '' });
    expect(result.status).toBe(0);
    expect(calls).toEqual(['']);
  });
});
