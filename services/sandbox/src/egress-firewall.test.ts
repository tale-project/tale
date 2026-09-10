// Exercise the egress entrypoint with fake netfilter commands. Keep its real
// control flow; substitute only /proc settings and the downstream proxy launcher.
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
const resolv = join(root, 'resolv.conf');
mkdirSync(bin);
mkdirSync(join(ipv6, 'conf/all'), { recursive: true });
mkdirSync(join(ipv6, 'conf/default'), { recursive: true });
mkdirSync(join(ipv6, 'conf/eth0'), { recursive: true });
mkdirSync(join(ipv6, 'conf/lo'), { recursive: true });
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
  .replaceAll('/etc/resolv.conf', resolv)
  .replace('exec /entrypoint.sh "$@"', 'exec "$TALE_FIREWALL_TEST_NEXT" "$@"');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function boot(
  fail: string = '',
  ipv6Disabled: boolean = false,
  interfaceDisabled: boolean = ipv6Disabled,
  settingUnavailable: boolean = false,
  resolverConfig: string | null = 'nameserver 127.0.0.11\n',
) {
  const log = join(root, 'calls');
  writeFileSync(log, '');
  rmSync(resolv, { recursive: true, force: true });
  if (resolverConfig === null) mkdirSync(resolv);
  else writeFileSync(resolv, resolverConfig);
  for (const profile of ['all', 'default', 'lo']) {
    rmSync(join(ipv6, `conf/${profile}/disable_ipv6`), {
      recursive: true,
      force: true,
    });
    writeFileSync(
      join(ipv6, `conf/${profile}/disable_ipv6`),
      ipv6Disabled ? '1' : '0',
    );
  }
  writeFileSync(
    join(ipv6, 'conf/eth0/disable_ipv6'),
    interfaceDisabled ? '1' : '0',
  );
  if (settingUnavailable) {
    rmSync(join(ipv6, 'conf/default/disable_ipv6'));
    mkdirSync(join(ipv6, 'conf/default/disable_ipv6'));
  }
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

  test('an enabled interface is disabled and verified before proxy start without ip6tables', () => {
    const { result, calls } = boot('ip6tables -L FORWARD', true, false);
    expect(result.status).toBe(0);
    expect(calls.at(-1)).toBe('proxy-start');
    expect(
      readFileSync(join(ipv6, 'conf/eth0/disable_ipv6'), 'utf8').trim(),
    ).toBe('1');
  });

  test('unfilterable IPv6 is permitted only when disabled for current and future interfaces', () => {
    const enabled = boot('ip6tables -L FORWARD');
    expect(enabled.result.status).toBe(0);
    for (const profile of ['all', 'default', 'eth0', 'lo']) {
      expect(
        readFileSync(join(ipv6, `conf/${profile}/disable_ipv6`), 'utf8').trim(),
      ).toBe('1');
    }
    const disabled = boot('ip6tables -L FORWARD', true);
    expect(disabled.result.status).toBe(0);
    expect(disabled.calls.at(-1)).toBe('proxy-start');
  });

  test('missing netfilter still refuses startup when namespace IPv6 disablement cannot be verified', () => {
    const { result, calls } = boot('ip6tables -L FORWARD', false, false, true);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('enable IPv6 netfilter');
    expect(calls).not.toContain('proxy-start');
  });

  test('cluster DNS is the only exact private destination admitted for new UDP and TCP port 53 traffic', () => {
    const { result, calls } = boot(
      '',
      false,
      false,
      false,
      'nameserver 172.31.0.10\n',
    );
    expect(result.status).toBe(0);
    for (const protocol of ['udp', 'tcp']) {
      const rule = `iptables -I OUTPUT -d 172.31.0.10/32 -p ${protocol} --dport 53 -j ACCEPT`;
      expect(calls).toContain(rule);
      expect(calls.indexOf(rule)).toBeGreaterThan(
        calls.indexOf(
          'iptables -I OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-net-prohibited',
        ),
      );
    }
    expect(
      calls.filter(
        (call) =>
          call.includes('-j ACCEPT') &&
          !call.includes('--ctstate') &&
          !call.includes('--dport 53'),
      ),
    ).toEqual([]);
    expect(calls).toContain('iptables -I FORWARD 1 -j DROP');
    expect(calls.at(-1)).toBe('proxy-start');
  });

  test('filterable IPv6 DNS receives only an exact /128 destination port 53 allowance', () => {
    const { result, calls } = boot(
      '',
      false,
      false,
      false,
      'nameserver fd00:1234::a\n',
    );
    expect(result.status).toBe(0);
    for (const protocol of ['udp', 'tcp']) {
      expect(calls).toContain(
        `ip6tables -I OUTPUT -d fd00:1234::a/128 -p ${protocol} --dport 53 -j ACCEPT`,
      );
    }
    expect(calls).toContain('ip6tables -I OUTPUT -d fc00::/7 -j REJECT');
  });

  test.each([
    'nameserver cluster-dns\n',
    'nameserver 172.31.0.0/16\n',
    'nameserver 172.031.0.10\n',
    'nameserver 172.31.0.256\n',
    'nameserver 172.31.0.10 extra\n',
    '#'.repeat(65537),
    Array.from(
      { length: 65 },
      (_, index) => `nameserver 10.0.0.${index + 1}\n`,
    ).join(''),
    null,
  ])(
    'invalid DNS inventory refuses startup without a hostname or broad-subnet exception',
    (config) => {
      const { result, calls } = boot('', false, false, false, config);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('DNS resolver');
      expect(calls).not.toContain('proxy-start');
      expect(calls.some((call) => call.includes('--dport 53'))).toBe(false);
    },
  );

  test('a failed DNS allowance never starts an unusable proxy', () => {
    const { result, calls } = boot(
      'iptables -I OUTPUT -d 172.31.0.10/32 -p udp --dport 53 -j ACCEPT',
      false,
      false,
      false,
      'nameserver 172.31.0.10\n',
    );
    expect(result.status).toBe(1);
    expect(calls).not.toContain('proxy-start');
  });

  test('a configured IPv6 resolver cannot bypass verified IPv6 disablement', () => {
    const { result, calls } = boot(
      'ip6tables -L FORWARD',
      true,
      true,
      false,
      'nameserver fd00:1234::a\n',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'configured IPv6 DNS resolver requires IPv6 netfilter',
    );
    expect(calls).not.toContain('proxy-start');
  });
});
