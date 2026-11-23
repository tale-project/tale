// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * The docker-entrypoint SSRF fence must never sever the container from its
 * own compose network: the OUTPUT chain filters same-bridge traffic too, so
 * directly-connected (scope link) subnets are ACCEPTed ahead of the RFC1918
 * REJECTs — and ONLY those; a via-learned route (say 10.0.0.0/8 through a
 * gateway) must not widen the pass-list. When no subnet is derivable (no
 * iproute2, empty scope-link table) the RFC1918 fence is skipped entirely
 * rather than self-severing, while IMDS + link-local stay rejected in every
 * scenario. This guard runs the real `install_ssrf_firewall` from the
 * shipped entrypoint against stubbed `ip`/`iptables` and asserts the emitted
 * rule program. Regression lock for the smoke-stack outage where backend-api
 * crash-looped on CONNECT_TIMEOUT db:5432.
 */

const ENTRYPOINT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docker-entrypoint.sh',
);

const LINK_ROUTES = [
  '172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.5',
  '10.89.0.0/24 dev eth1 proto kernel scope link src 10.89.0.7',
].join('\n');

// Emitted only when the implementation forgets `scope link`: a leaked ACCEPT
// for this subnet would swallow the whole 10/8 fence.
const VIA_ROUTE = '10.0.0.0/8 via 172.18.0.1 dev eth0';

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`^${name}\\(\\) \\{$[\\s\\S]*?^\\}$`, 'm').exec(
    source,
  );
  if (!match) {
    throw new Error(
      `${name}() not found in docker-entrypoint.sh — update this guard alongside the entrypoint`,
    );
  }
  return match[0];
}

/**
 * The firewall and its resolver parser, with the resolv.conf path pointed
 * at the harness's own file so a test never reads the host's.
 */
function extractFirewallFunctions(resolvConf: string): string {
  const source = readFileSync(ENTRYPOINT, 'utf8');
  const firewall = extractFunction(source, 'install_ssrf_firewall');
  if (!firewall.includes('</etc/resolv.conf')) {
    throw new Error(
      'install_ssrf_firewall() no longer reads /etc/resolv.conf — update this guard alongside the entrypoint',
    );
  }
  return [
    extractFunction(source, 'ssrf_dns_upstreams'),
    firewall.replaceAll('</etc/resolv.conf', `<"${resolvConf}"`),
  ].join('\n');
}

function resolveAwk(): string {
  const candidate = ['/usr/bin/awk', '/bin/awk'].find((p) => existsSync(p));
  if (!candidate) {
    throw new Error('no awk binary found for the PATH-restricted harness');
  }
  return candidate;
}

interface HarnessResult {
  /** `-A OUTPUT …` invocations in emission order, argv joined by spaces. */
  rules: string[];
  /** Every iptables invocation, in order. */
  calls: string[];
  stdout: string;
  stderr: string;
  status: number | null;
}

function runFirewall(options: {
  withIp: boolean;
  routes: string;
  /** Exit status of the stub for the conntrack match (kernel without it). */
  conntrackExit?: number;
  /** The container's resolv.conf; absent when undefined. */
  resolvConf?: string;
}): HarnessResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'ssrf-guard-'));
  tempDirs.push(dir);
  const log = path.join(dir, 'iptables.log');
  const resolvConf = path.join(dir, 'resolv.conf');
  if (options.resolvConf !== undefined) {
    writeFileSync(resolvConf, options.resolvConf);
  }

  writeFileSync(
    path.join(dir, 'iptables'),
    [
      '#!/bin/bash',
      `echo "$*" >> "${log}"`,
      `case "$*" in *conntrack*) exit ${options.conntrackExit ?? 0} ;; esac`,
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  if (options.withIp) {
    // Scope-link queries get the connected subnets; any broader query also
    // gets the via-learned route, so dropping `scope link` leaks it.
    const routeArgs = options.routes
      .split('\n')
      .filter(Boolean)
      .map((route) => `"${route}"`)
      .join(' ');
    writeFileSync(
      path.join(dir, 'ip'),
      [
        '#!/bin/bash',
        'case "$*" in',
        `  *"scope link"*) [ -n '${routeArgs}' ] && printf '%s\\n' ${routeArgs} ;;`,
        `  *) printf '%s\\n' ${routeArgs} "${VIA_ROUTE}" ;;`,
        'esac',
        'exit 0',
      ].join('\n'),
      { mode: 0o755 },
    );
  }
  symlinkSync(resolveAwk(), path.join(dir, 'awk'));

  const driver = path.join(dir, 'driver.sh');
  writeFileSync(
    driver,
    [
      'set -u',
      'log_info() { echo "INFO: $*"; }',
      'log_warn() { echo "WARN: $*" >&2; }',
      extractFirewallFunctions(resolvConf),
      'install_ssrf_firewall',
    ].join('\n'),
  );

  const result = spawnSync('/bin/bash', [driver], {
    env: { PATH: dir, IPTABLES_LOG: log },
    encoding: 'utf8',
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  return {
    rules: calls.filter((line) => line.startsWith('-A OUTPUT')),
    calls,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('install_ssrf_firewall rule program', () => {
  it('accepts scope-link subnets ahead of the RFC1918 rejects, never via routes', () => {
    const { rules, status } = runFirewall({
      withIp: true,
      routes: LINK_ROUTES,
    });
    expect(status).toBe(0);

    const accepts = rules.filter((r) => r.endsWith('-j ACCEPT'));
    expect(accepts).toEqual([
      '-A OUTPUT -d 172.18.0.0/16 -j ACCEPT',
      '-A OUTPUT -d 10.89.0.0/24 -j ACCEPT',
    ]);
    // The via-learned 10.0.0.0/8 must never be passed.
    expect(accepts.some((r) => r.includes('10.0.0.0/8'))).toBe(false);

    // IMDS + link-local rejected before anything else.
    expect(rules[0]).toContain('-d 169.254.169.254/32 -j REJECT');
    expect(rules[1]).toContain('-d 169.254.0.0/16 -j REJECT');

    // The full RFC1918 fence lands after the ACCEPTs.
    const lastAccept = rules.indexOf(accepts[accepts.length - 1]!);
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
      const reject = rules.findIndex(
        (r) => r.includes(`-d ${cidr}`) && r.includes('-j REJECT'),
      );
      expect(reject, `REJECT for ${cidr}`).toBeGreaterThan(lastAccept);
    }
  });

  it('skips the RFC1918 fence when the scope-link table is empty', () => {
    const { rules, stderr } = runFirewall({ withIp: true, routes: '' });
    expect(rules.some((r) => r.includes('169.254.169.254/32'))).toBe(true);
    expect(rules.some((r) => r.includes('169.254.0.0/16'))).toBe(true);
    expect(rules.some((r) => r.endsWith('-j ACCEPT'))).toBe(false);
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
      expect(
        rules.some((r) => r.includes(`-d ${cidr}`)),
        `no fence for ${cidr}`,
      ).toBe(false);
    }
    expect(stderr).toContain('RFC1918 fence NOT installed');
  });

  it('skips the RFC1918 fence when iproute2 is unavailable', () => {
    const { rules, stderr } = runFirewall({ withIp: false, routes: '' });
    expect(rules.some((r) => r.includes('169.254.169.254/32'))).toBe(true);
    expect(rules.some((r) => r.endsWith('-j ACCEPT'))).toBe(false);
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
      expect(
        rules.some((r) => r.includes(`-d ${cidr}`)),
        `no fence for ${cidr}`,
      ).toBe(false);
    }
    expect(stderr).toContain('RFC1918 fence NOT installed');
  });

  // A reply is not SSRF. A peer outside the directly-connected subnets (a
  // sandbox session routed in from another network, as on Incus) must get
  // the answer to a connection it opened: the accept for established
  // connections goes first in OUTPUT, ahead of every REJECT, as the sandbox
  // egress installs it.
  it.each([
    ['connected subnets', { withIp: true, routes: LINK_ROUTES }],
    ['no derivable subnet', { withIp: true, routes: '' }],
    ['no iproute2', { withIp: false, routes: '' }],
  ])('accepts replies on established connections first (%s)', (_, options) => {
    const { calls, status } = runFirewall(options);
    expect(status).toBe(0);
    const established =
      '-I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT';
    expect(calls).toContain(established);
    // Inserted (-I) at the head of the chain, after every appended rule.
    expect(calls.indexOf(established)).toBe(calls.length - 1);
  });

  it('falls back to the state match, and never stops the start, without conntrack', () => {
    const { calls, status, stderr } = runFirewall({
      withIp: true,
      routes: LINK_ROUTES,
      conntrackExit: 1,
    });
    expect(status).toBe(0);
    expect(calls.at(-1)).toBe(
      '-I OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    );
    expect(stderr).not.toContain('failed to accept replies');
  });

  // Docker's embedded resolver forwards external names to the daemon's
  // upstream servers from inside this network namespace. An upstream on a
  // private address outside the connected subnets (an Incus bridge
  // gateway, a VPC resolver) must keep DNS — and only DNS — through the
  // RFC1918 fence, or every external lookup fails with EAI_AGAIN.
  describe('DNS to the upstream resolvers', () => {
    const EMBEDDED = [
      '# Generated by Docker Engine.',
      'nameserver 127.0.0.11',
      'options ndots:0',
      '',
    ].join('\n');

    function dnsAccepts(rules: string[]): string[] {
      return rules.filter((r) => r.includes('--dport 53'));
    }

    function dnsRule(address: string, protocol: 'udp' | 'tcp'): string {
      return `-A OUTPUT -d ${address}/32 -p ${protocol} --dport 53 -j ACCEPT`;
    }

    function assertAheadOfFence(rules: string[]): void {
      const lastDns = Math.max(
        ...dnsAccepts(rules).map((rule) => rules.indexOf(rule)),
      );
      for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
        const reject = rules.findIndex(
          (r) => r.includes(`-d ${cidr}`) && r.includes('-j REJECT'),
        );
        expect(reject, `REJECT for ${cidr}`).toBeGreaterThan(lastDns);
      }
    }

    it('allows the embedded DNS upstreams of the ExtServers comment', () => {
      const { rules, status, stdout } = runFirewall({
        withIp: true,
        routes: LINK_ROUTES,
        resolvConf: `${EMBEDDED}\n# Based on host file: '/etc/resolv.conf' (internal resolver)\n# ExtServers: [10.200.50.97 host(192.168.1.1) host(127.0.0.53)]\n# Overrides: [nameservers]\n`,
      });
      expect(status).toBe(0);
      expect(dnsAccepts(rules)).toEqual([
        dnsRule('10.200.50.97', 'udp'),
        dnsRule('10.200.50.97', 'tcp'),
        dnsRule('192.168.1.1', 'udp'),
        dnsRule('192.168.1.1', 'tcp'),
      ]);
      assertAheadOfFence(rules);
      // Nothing beyond port 53 to the resolver, and never the stub itself.
      expect(rules.filter((r) => r.includes('10.200.50.97'))).toHaveLength(2);
      expect(rules.some((r) => r.includes('127.'))).toBe(false);
      expect(stdout).toContain(
        'DNS (udp+tcp 53) allowed to upstream resolvers: 10.200.50.97 192.168.1.1',
      );
    });

    it('allows plain nameserver lines without the embedded DNS', () => {
      const { rules, status } = runFirewall({
        withIp: true,
        routes: LINK_ROUTES,
        resolvConf: [
          'search tale.svc.cluster.local',
          'nameserver 10.96.0.10 ; cluster DNS',
          'nameserver 10.96.0.10',
          '  nameserver\t192.168.178.1',
          '#nameserver 10.1.1.1',
          'options ndots:5',
          '',
        ].join('\n'),
      });
      expect(status).toBe(0);
      expect(dnsAccepts(rules)).toEqual([
        dnsRule('10.96.0.10', 'udp'),
        dnsRule('10.96.0.10', 'tcp'),
        dnsRule('192.168.178.1', 'udp'),
        dnsRule('192.168.178.1', 'tcp'),
      ]);
      assertAheadOfFence(rules);
    });

    it('allows nothing for the embedded resolver alone', () => {
      const { rules, status, stderr } = runFirewall({
        withIp: true,
        routes: LINK_ROUTES,
        resolvConf: EMBEDDED,
      });
      expect(status).toBe(0);
      expect(dnsAccepts(rules)).toEqual([]);
      expect(stderr).toContain('no upstream DNS resolver derivable');
      // The fence itself is unchanged.
      for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
        expect(rules.some((r) => r.includes(`-d ${cidr} -j REJECT`))).toBe(
          true,
        );
      }
    });

    it('ignores what is no IPv4 address', () => {
      const { rules, status } = runFirewall({
        withIp: true,
        routes: LINK_ROUTES,
        resolvConf: [
          'nameserver 10.0.0.0/8',
          'nameserver 10.1.2',
          'nameserver 010.1.2.3',
          'nameserver 10.1.2.300',
          'nameserver 10.1.2.3 extra',
          'nameserver resolver.internal',
          'nameserver fd00::53',
          'nameserver 0.0.0.0',
          // Link-local stays behind the metadata guard; an accept after it
          // would be dead and the log would claim otherwise.
          'nameserver 169.254.169.253',
          'nameserver $(touch /tmp/pwned)',
          'nameserver',
          '# ExtServers: [host(10.2.3.4 10.3.4.5/24 ;10.4.5.6 host() ]',
          'nameserver 10.5.6.7',
          '',
        ].join('\n'),
      });
      expect(status).toBe(0);
      expect(dnsAccepts(rules)).toEqual([
        dnsRule('10.5.6.7', 'udp'),
        dnsRule('10.5.6.7', 'tcp'),
      ]);
    });

    it('reads no resolver and keeps the fence when resolv.conf is missing', () => {
      const { rules, status, stderr } = runFirewall({
        withIp: true,
        routes: LINK_ROUTES,
      });
      expect(status).toBe(0);
      expect(dnsAccepts(rules)).toEqual([]);
      expect(stderr).toContain('no upstream DNS resolver derivable');
      expect(stderr).not.toContain('resolv.conf: No such file');
    });

    it('adds no DNS rule when the RFC1918 fence is skipped', () => {
      const { rules } = runFirewall({
        withIp: true,
        routes: '',
        resolvConf: '# ExtServers: [10.200.50.97]\n',
      });
      expect(dnsAccepts(rules)).toEqual([]);
    });
  });
});
