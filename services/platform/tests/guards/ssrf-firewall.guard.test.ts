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

function extractFirewallFunction(): string {
  const source = readFileSync(ENTRYPOINT, 'utf8');
  const match = /^install_ssrf_firewall\(\) \{$[\s\S]*?^\}$/m.exec(source);
  if (!match) {
    throw new Error(
      'install_ssrf_firewall() not found in docker-entrypoint.sh — update this guard alongside the entrypoint',
    );
  }
  return match[0];
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
  stderr: string;
  status: number | null;
}

function runFirewall(options: {
  withIp: boolean;
  routes: string;
}): HarnessResult {
  const dir = mkdtempSync(path.join(tmpdir(), 'ssrf-guard-'));
  tempDirs.push(dir);
  const log = path.join(dir, 'iptables.log');

  writeFileSync(
    path.join(dir, 'iptables'),
    `#!/bin/bash\necho "$*" >> "${log}"\nexit 0\n`,
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
      'log_info() { :; }',
      'log_warn() { echo "WARN: $*" >&2; }',
      extractFirewallFunction(),
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
});
