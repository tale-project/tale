// Exercise the egress entrypoint with fake netfilter commands. Keep its real
// control flow; substitute only /proc reads and the downstream proxy launcher.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-egress-guard-'));
const bin = join(root, 'bin');
const ipv6 = join(root, 'ipv6');
mkdirSync(bin);
mkdirSync(join(ipv6, 'conf/all'), { recursive: true });
mkdirSync(join(ipv6, 'conf/default'), { recursive: true });
mkdirSync(join(ipv6, 'conf/eth0'), { recursive: true });
const firewall = `#!/bin/sh
name="\${0##*/}"
printf '%s %s\\n' "$name" "$*" >> "$TALE_FIREWALL_TEST_LOG"
[ "$name $*" != "$TALE_FIREWALL_TEST_FAIL" ]
`;
for (const name of ['iptables', 'ip6tables'])
  writeFileSync(join(bin, name), firewall, { mode: 0o755 });
const launch = join(bin, 'proxy-start');
writeFileSync(
  launch,
  '#!/bin/sh\nprintf "proxy-start\\n" >> "$TALE_FIREWALL_TEST_LOG"\n',
  { mode: 0o755 },
);
const entrypoint = readFileSync(
  resolve(import.meta.dir, '../../sandbox-egress/docker-entrypoint.sh'),
  'utf8',
)
  .replaceAll('/proc/sys/net/ipv6', ipv6)
  .replace('exec /entrypoint.sh "$@"', 'exec "$TALE_FIREWALL_TEST_NEXT" "$@"');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function boot(
  fail: string = '',
  ipv6Disabled: boolean = false,
  interfaceDisabled: boolean = ipv6Disabled,
) {
  const log = join(root, 'calls');
  writeFileSync(log, '');
  for (const profile of ['all', 'default']) {
    writeFileSync(
      join(ipv6, `conf/${profile}/disable_ipv6`),
      ipv6Disabled ? '1' : '0',
    );
  }
  writeFileSync(
    join(ipv6, 'conf/eth0/disable_ipv6'),
    interfaceDisabled ? '1' : '0',
  );
  const result = spawnSync('/bin/sh', ['-c', entrypoint], {
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TALE_SKIP_SSRF_FIREWALL: '0',
      TALE_FIREWALL_TEST_FAIL: fail,
      TALE_FIREWALL_TEST_LOG: log,
      TALE_FIREWALL_TEST_NEXT: launch,
    },
    encoding: 'utf8',
  });
  return { result, calls: readFileSync(log, 'utf8').trim().split('\n') };
}

describe('multi-network egress isolation', () => {
  test('client ACL accepts every admitted private build-network range and loopback only', () => {
    const template = readFileSync(
      resolve(import.meta.dir, '../../sandbox-egress/tinyproxy.conf.template'),
      'utf8',
    );
    const clients = template
      .split('\n')
      .filter((line) => line.startsWith('Allow '));
    expect(clients).toEqual([
      'Allow 127.0.0.1',
      'Allow ::1',
      'Allow 10.0.0.0/8',
      'Allow 172.16.0.0/12',
      'Allow 192.168.0.0/16',
    ]);
  });

  test('drops forwarded IPv4 and IPv6 before starting the proxy; retains response traffic', () => {
    const { result, calls } = boot();
    expect(result.status).toBe(0);
    expect(calls).toContain('iptables -I FORWARD 1 -j DROP');
    expect(calls).toContain('ip6tables -I FORWARD 1 -j DROP');
    expect(calls).toContain(
      'iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    );
    expect(calls).toContain(
      'ip6tables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    );
    expect(calls.at(-1)).toBe('proxy-start');
  });

  test('cannot start when either forwarding rule fails', () => {
    for (const family of ['iptables', 'ip6tables']) {
      const { result, calls } = boot(`${family} -I FORWARD 1 -j DROP`);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('forwarding guard unavailable');
      expect(calls).not.toContain('proxy-start');
    }
  });

  test('private-destination filtering must install before the proxy starts', () => {
    for (const rule of [
      'iptables -I OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited',
      'ip6tables -I OUTPUT -d fc00::/7 -j REJECT',
    ]) {
      const { result, calls } = boot(rule);
      expect(result.status).toBe(1);
      expect(calls).not.toContain('proxy-start');
    }
  });

  test('all/default disabled cannot mask an enabled interface without ip6tables', () => {
    const { result, calls } = boot('ip6tables -L FORWARD', true, false);
    expect(result.status).toBe(1);
    expect(calls).not.toContain('proxy-start');
  });

  test('unfilterable IPv6 is permitted only when disabled for current and future interfaces', () => {
    const enabled = boot('ip6tables -L FORWARD');
    expect(enabled.result.status).toBe(1);
    expect(enabled.calls).not.toContain('proxy-start');
    const disabled = boot('ip6tables -L FORWARD', true);
    expect(disabled.result.status).toBe(0);
    expect(disabled.calls.at(-1)).toBe('proxy-start');
  });
});
