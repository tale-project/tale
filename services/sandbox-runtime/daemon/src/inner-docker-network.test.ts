import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-inner-network-'));
const bin = join(root, 'bin');
const log = join(root, 'calls');
const resolv = join(root, 'resolv.conf');
const dockerState = join(root, 'docker-network-state');
mkdirSync(bin);
const python = Bun.which('python3');
if (!python)
  throw new Error('Python 3 is required for the runtime network tests');
const source = readFileSync(
  resolve(import.meta.dir, '../../entrypoint.sh'),
  'utf8',
);
const helpers = source
  .slice(0, source.indexOf('# K8s transparent-egress native sidecar.'))
  .replaceAll('/usr/local/bin/python3', python)
  .replaceAll('/etc/resolv.conf', resolv)
  .replaceAll('/var/lib/docker/network/files/local-kv.db', dockerState)
  .replaceAll('/var/log/dockerd.log', join(root, 'dockerd.log'))
  .replaceAll('/etc/redsocks.conf', join(root, 'redsocks.conf'))
  .replaceAll('/var/log/redsocks.log', join(root, 'redsocks.log'))
  .replaceAll('/usr/sbin/redsocks', join(bin, 'redsocks'));
writeFileSync(
  join(bin, 'ip'),
  `#!/usr/bin/env bun
if (process.env.TALE_NETWORK_TEST_HANG === '1') await new Promise(resolve => setTimeout(resolve, 30000));
if (process.env.TALE_NETWORK_TEST_READ_FAIL === '1') process.exit(1);
if (process.env.TALE_NETWORK_TEST_OVERSIZED === '1') console.log(' '.repeat(2 * 1024 * 1024));
else if (process.argv.includes('addr')) console.log(process.env.TALE_NETWORK_TEST_ADDRESSES);
else console.log(process.env.TALE_NETWORK_TEST_ROUTES);
`,
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'getent'),
  `#!/usr/bin/env bun
if (process.env.TALE_NETWORK_TEST_DNS_HANG === '1') await new Promise(resolve => setTimeout(resolve, 30000));
const records = JSON.parse(process.env.TALE_NETWORK_TEST_HOSTS || '{}');
const addresses = records[process.argv.at(-1)];
if (!addresses) process.exit(2);
for (const address of addresses) console.log(address + ' STREAM configured-host');
`,
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'dockerd'),
  `#!/bin/sh
sleep 0.1
printf 'dockerd %s\\n' "$*" >> "$TALE_NETWORK_TEST_LOG"
exec sleep 30
`,
  { mode: 0o755 },
);
// Match real readiness: the background daemon must start before `docker info`
// succeeds. An unconditional success lets EXIT kill the stub before it logs
// argv on a busy CI runner. The delayed startup above makes that race explicit.
writeFileSync(
  join(bin, 'docker'),
  '#!/bin/sh\ngrep -q "^dockerd " "$TALE_NETWORK_TEST_LOG"\n',
  { mode: 0o755 },
);
writeFileSync(join(bin, 'redsocks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 77\n', { mode: 0o755 });
writeFileSync(
  join(root, 'ipaddress.py'),
  'raise RuntimeError("User module must never run")\n',
);
writeFileSync(
  join(bin, 'iptables'),
  `#!/bin/sh
printf 'iptables %s\\n' "$*" >> "$TALE_NETWORK_TEST_LOG"
[ "$3" != '-C' ]
`,
  { mode: 0o755 },
);
const initialRoutes = [{ dst: '172.18.0.0/16', dev: 'eth0' }];
function run(command: string, env: Record<string, string> = {}) {
  writeFileSync(log, '');
  rmSync(dockerState, { recursive: true, force: true });
  if (env.TALE_NETWORK_TEST_DOCKER_STATE === 'directory') {
    mkdirSync(dockerState);
  } else if (env.TALE_NETWORK_TEST_DOCKER_STATE) {
    writeFileSync(dockerState, 'retained Docker network state', {
      mode: env.TALE_NETWORK_TEST_DOCKER_STATE === 'writable' ? 0o666 : 0o644,
    });
    if (env.TALE_NETWORK_TEST_DOCKER_STATE === 'writable')
      chmodSync(dockerState, 0o666);
  }
  writeFileSync(
    resolv,
    env.TALE_NETWORK_TEST_RESOLV ?? 'nameserver 127.0.0.11\n',
  );
  const result = spawnSync(
    '/bin/sh',
    [
      '-c',
      `${helpers}\n_IP='${join(bin, 'ip')}'\n_GETENT='${join(bin, 'getent')}'\n${command}`,
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        TALE_NETWORK_TEST_ROUTES: JSON.stringify(initialRoutes),
        TALE_NETWORK_TEST_ADDRESSES: JSON.stringify([
          {
            ifname: 'eth0',
            addr_info: [{ family: 'inet', local: '172.18.0.2', prefixlen: 16 }],
          },
        ]),
        TALE_NETWORK_TEST_READ_FAIL: '0',
        TALE_NETWORK_TEST_HANG: '0',
        TALE_NETWORK_TEST_OVERSIZED: '0',
        TALE_NETWORK_TEST_LOG: log,
        TALE_NETWORK_TEST_HOSTS: '{}',
        TALE_NETWORK_TEST_DNS_HANG: '0',
        TALE_BUILDKITD_ENDPOINT: 'tcp://org-builder:1234',
        TALE_BUILDKIT_NETWORK_SUBNETS: '["172.19.0.0/23"]',
        TALE_DIND_INNER_POOL_OVERRIDE: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        TALE_GATEWAY_URL: '',
        TALE_RUNTIME_TIER: 'runc',
        ...env,
      },
      encoding: 'utf8',
      timeout: 8_000,
    },
  );
  return { result, calls: readFileSync(log, 'utf8') };
}
const select =
  'select_inner_docker_pool\nprintf "POOL=%s BIP=%s\\n" "$TALE_DIND_INNER_POOL" "$TALE_DIND_INNER_BIP"';
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('adaptive inner Docker network', () => {
  test('keeps the historical pool when it does not overlap outer or planned routes', () => {
    const { result } = run(select);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.31.0.0/16 BIP=172.31.0.1/24');
  });
  test('ignores inherited pool values and user Python module or PATH overrides', () => {
    const { result } = run(select, {
      TALE_DIND_INNER_POOL: '8.8.0.0/16',
      TALE_DIND_INNER_BIP: '8.8.0.1/24',
      PYTHONPATH: root,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.31.0.0/16 BIP=172.31.0.1/24');
  });
  test('moves away from a control network using 172.31/16', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES: '[{"dst":"172.31.0.0/16","dev":"eth0"}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.16.0.0/16 BIP=172.16.0.1/24');
  });
  test('Pod addresses exclude their pool even with only a link-local default route', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"default","gateway":"169.254.1.1","dev":"eth0"}]',
      TALE_NETWORK_TEST_ADDRESSES:
        '[{"ifname":"eth0","addr_info":[{"family":"inet","local":"172.31.45.9","prefixlen":32}]}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.16.0.0/16');
  });
  test('interface prefixes and default gateway IPs also exclude candidate pools', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"default","gateway":"10.0.0.1","dev":"net1"}]',
      TALE_NETWORK_TEST_ADDRESSES:
        '[{"ifname":"net1","addr_info":[{"family":"inet","local":"172.20.4.3","prefixlen":12}]}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=10.1.0.0/16');
  });
  test('numeric gateways cannot masquerade as a complete route observation', () => {
    const automatic = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"default","gateway":123,"dev":"eth0"}]',
    });
    expect(automatic.result.status).toBe(1);
    expect(automatic.result.stderr).toContain('invalid gateway');
    const override = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"default","gateway":123,"dev":"eth0"},{"dst":"10.200.0.0/24","dev":"eth0"}]',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(override.result.status).toBe(1);
    expect(override.result.stderr).toContain(
      'configured inner Docker pool overlaps',
    );
  });
  test('sparse Pod routes cannot hide cluster DNS or configured proxy and gateway IPs', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"default","gateway":"169.254.1.1","dev":"eth0"}]',
      TALE_NETWORK_TEST_RESOLV:
        'search sandbox.svc.cluster.local\nnameserver 172.31.0.10\n',
      HTTPS_PROXY: 'http://172.16.4.10:3128',
      HTTP_PROXY: 'http://proxy.sandbox.svc:3128',
      TALE_GATEWAY_URL: 'http://gateway.sandbox.svc:8080',
      TALE_NETWORK_TEST_HOSTS:
        '{"proxy.sandbox.svc":["172.17.3.20"],"gateway.sandbox.svc":["172.20.0.10","172.21.0.10"]}',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.22.0.0/16');
  });
  test('an explicit private /16 remains subject to known network and DNS overlaps', () => {
    const cases: Record<string, string>[] = [
      { TALE_BUILDKIT_NETWORK_SUBNETS: '["10.200.2.0/23"]' },
      { TALE_NETWORK_TEST_RESOLV: 'nameserver 10.200.0.10\n' },
      { HTTPS_PROXY: 'http://10.200.0.20:3128' },
    ];
    for (const env of cases) {
      const { result } = run(select, {
        TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
        ...env,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('configured inner Docker pool overlaps');
    }
  });
  test('an operator override can handle unavailable inventory while preserving known conflicts', () => {
    const unavailable = run(select, {
      TALE_NETWORK_TEST_READ_FAIL: '1',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(unavailable.result.status).toBe(0);
    expect(unavailable.result.stderr).toContain('WARN');
    expect(unavailable.result.stderr).toContain('outer route inventory');
    expect(unavailable.result.stdout).toContain(
      'POOL=10.200.0.0/16 BIP=10.200.0.1/24',
    );
    const conflict = run(select, {
      TALE_NETWORK_TEST_READ_FAIL: '1',
      TALE_NETWORK_TEST_RESOLV: 'nameserver 10.200.0.10\n',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(conflict.result.status).toBe(1);
    expect(conflict.result.stderr).toContain(
      'configured inner Docker pool overlaps',
    );
  });
  test('partial malformed inventory cannot discard a known overlap under override', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"invalid"},{"dst":"10.200.0.0/24","dev":"eth0"}]',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('configured inner Docker pool overlaps');
  });
  test('a broken address observation cannot hide another interface conflict from an override', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ADDRESSES:
        '[{}, {"ifname":"eth0","addr_info":[{"family":"inet","local":"10.200.4.6","prefixlen":32}]}]',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('configured inner Docker pool overlaps');
  });
  test('malformed addresses or resolver settings refuse automatic selection', () => {
    const cases: Record<string, string>[] = [
      {
        TALE_NETWORK_TEST_ADDRESSES:
          '[{"ifname":"eth0","addr_info":[{"family":"inet","local":"bad","prefixlen":32}]}]',
      },
      { TALE_NETWORK_TEST_RESOLV: 'nameserver invalid-address\n' },
      { TALE_NETWORK_TEST_RESOLV: '#'.repeat(65537) },
    ];
    for (const env of cases) {
      const { result } = run(select, env);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('POOL=');
    }
  });
  test.each([
    '172.31.0.1/16',
    '172.31.0.0/24',
    '8.8.0.0/16',
    'fc00::/16',
    'invalid',
  ])('an invalid operator override never falls back: %s', (pool) => {
    const { result } = run(select, { TALE_DIND_INNER_POOL_OVERRIDE: pool });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('configured inner Docker pool');
    expect(result.stdout).not.toContain('POOL=');
  });
  test('unresolved configured hosts refuse automatic selection but permit an explicit override warning', () => {
    const automatic = run(select, {
      HTTPS_PROXY: 'http://missing.sandbox.svc:3128',
    });
    expect(automatic.result.status).toBe(1);
    expect(automatic.result.stderr).toContain('HTTPS_PROXY IPv4 resolution');
    const override = run(select, {
      HTTPS_PROXY: 'http://missing.sandbox.svc:3128',
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
    });
    expect(override.result.status).toBe(0);
    expect(override.result.stderr).toContain('WARN');
    expect(override.result.stdout).toContain('POOL=10.200.0.0/16');
  });
  test('configured hostname resolution shares the bounded startup budget', () => {
    const { result } = run(select, {
      HTTPS_PROXY: 'http://proxy.sandbox.svc:3128',
      TALE_NETWORK_TEST_DNS_HANG: '1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HTTPS_PROXY IPv4 resolution');
  }, 10_000);
  test('reserves the planned build network before its eth1 exists', () => {
    const { result } = run(select, {
      TALE_BUILDKIT_NETWORK_SUBNETS: '["172.31.12.0/23","172.16.0.0/16"]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.17.0.0/16 BIP=172.17.0.1/24');
  });
  test('tries other private ranges when all 172.16/12 routes are occupied', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"172.16.0.0/12","dev":"eth0"},{"dst":"default","gateway":"172.18.0.1","dev":"eth0"}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=10.0.0.0/16 BIP=10.0.0.1/24');
  });
  test('ignores default routing but avoids host routes in secondary routing tables', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"0.0.0.0/0","dev":"eth0"},{"dst":"172.31.55.9","table":"100","dev":"eth0"}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.16.0.0/16');
  });
  test('missing hints are compatible only with already dual-homed legacy startup', () => {
    const legacy = run(select, {
      TALE_BUILDKIT_NETWORK_SUBNETS: '',
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"172.18.0.0/16","dev":"eth0"},{"dst":"172.31.0.0/16","dev":"eth1"}]',
    });
    expect(legacy.result.status).toBe(0);
    expect(legacy.result.stdout).toContain('POOL=172.16.0.0/16');
    const unsafe = run(select, { TALE_BUILDKIT_NETWORK_SUBNETS: '' });
    expect(unsafe.result.status).toBe(1);
    expect(unsafe.result.stderr).toContain('planned build-network');
  });
  test.each([
    'no-json',
    '{}',
    '[]',
    '["not-a-subnet"]',
    '["172.31.0.1/16"]',
    '["::1/128"]',
  ])('malformed planned hints fail closed: %s', (hints) => {
    const { result } = run(select, { TALE_BUILDKIT_NETWORK_SUBNETS: hints });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('POOL=');
  });
  test.each(['no-json', '{}', '[{}]', '[{"dst":"invalid"}]'])(
    'malformed route inventory fails closed: %s',
    (routes) => {
      const { result } = run(select, { TALE_NETWORK_TEST_ROUTES: routes });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('POOL=');
    },
  );
  test('unreadable or oversized routes do not become an empty inventory', () => {
    for (const key of [
      'TALE_NETWORK_TEST_READ_FAIL',
      'TALE_NETWORK_TEST_OVERSIZED',
    ]) {
      const { result } = run(select, { [key]: '1' });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('POOL=');
    }
  });
  test('a stalled route reader is killed within its startup budget', () => {
    const { result } = run(select, { TALE_NETWORK_TEST_HANG: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outer route inventory timed out');
  }, 10_000);
  test('exhausted private space refuses dockerd startup', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"10.0.0.0/8","dev":"eth0"},{"dst":"172.16.0.0/12","dev":"eth0"},{"dst":"192.168.0.0/16","dev":"eth0"}]',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no non-overlapping private /16');
  });
  test('non-cache DinD derives its pool without planned network hints', () => {
    const { result } = run(select, {
      TALE_BUILDKITD_ENDPOINT: '',
      TALE_BUILDKIT_NETWORK_SUBNETS: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.31.0.0/16');
  });
  test('retained default and generated inner bridges do not shift the pool on Pod container restart', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_DOCKER_STATE: 'valid',
      TALE_NETWORK_TEST_ROUTES:
        '[{"dst":"172.18.0.0/16","dev":"eth0"},{"dst":"172.31.0.0/24","dev":"docker0","protocol":"kernel"},{"dst":"172.31.1.0/24","dev":"br-40efa8f48502","protocol":"kernel"},{"dst":"172.31.1.1","dev":"br-40efa8f48502","protocol":"kernel","type":"local"}]',
      TALE_NETWORK_TEST_ADDRESSES:
        '[{"ifname":"eth0","addr_info":[{"family":"inet","local":"172.18.0.2","prefixlen":16}]},{"ifname":"docker0","linkinfo":{"info_kind":"bridge"},"addr_info":[{"family":"inet","local":"172.31.0.1","prefixlen":24}]},{"ifname":"br-40efa8f48502","linkinfo":{"info_kind":"bridge"},"addr_info":[{"family":"inet","local":"172.31.1.1","prefixlen":24}]}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.31.0.0/16');
  });
  test('an explicit pool can reuse verified retained inner bridge addresses', () => {
    const { result } = run(select, {
      TALE_DIND_INNER_POOL_OVERRIDE: '10.200.0.0/16',
      TALE_NETWORK_TEST_DOCKER_STATE: 'valid',
      TALE_NETWORK_TEST_ADDRESSES:
        '[{"ifname":"docker0","linkinfo":{"info_kind":"bridge"},"addr_info":[{"family":"inet","local":"10.200.0.1","prefixlen":24}]}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=10.200.0.0/16');
  });
  test('Docker-looking names without verified bridge kind or protected state remain occupied', () => {
    const cases: [string, string][] = [
      ['', 'bridge'],
      ['directory', 'bridge'],
      ['writable', 'bridge'],
      ['valid', 'veth'],
      ['valid', 'unknown'],
    ];
    for (const [state, kind] of cases) {
      const { result } = run(select, {
        TALE_NETWORK_TEST_DOCKER_STATE: state,
        TALE_NETWORK_TEST_ADDRESSES: JSON.stringify([
          {
            ifname: 'br-40efa8f48502',
            linkinfo: { info_kind: kind },
            addr_info: [{ family: 'inet', local: '172.31.1.1', prefixlen: 24 }],
          },
        ]),
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('POOL=172.16.0.0/16');
    }
  });
  test('verified Docker bridges cannot hide unrelated static routes or route gateways', () => {
    for (const route of [
      { dst: '172.31.0.0/24', dev: 'docker0', protocol: 'static' },
      { dst: '172.31.88.0/24', dev: 'docker0', protocol: 'kernel' },
      { dst: 'default', dev: 'docker0', gateway: '172.31.0.2' },
    ]) {
      const { result } = run(select, {
        TALE_NETWORK_TEST_DOCKER_STATE: 'valid',
        TALE_NETWORK_TEST_ROUTES: JSON.stringify([route]),
        TALE_NETWORK_TEST_ADDRESSES:
          '[{"ifname":"docker0","linkinfo":{"info_kind":"bridge"},"addr_info":[{"family":"inet","local":"172.31.0.1","prefixlen":24}]}]',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('POOL=172.16.0.0/16');
    }
  });
  test('unrecognized custom bridge names remain occupied instead of claiming Docker ownership', () => {
    const { result } = run(select, {
      TALE_NETWORK_TEST_DOCKER_STATE: 'valid',
      TALE_NETWORK_TEST_ADDRESSES:
        '[{"ifname":"custom-bridge","linkinfo":{"info_kind":"bridge"},"addr_info":[{"family":"inet","local":"172.31.0.1","prefixlen":24}]}]',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('POOL=172.16.0.0/16');
  });
  test('the actual transparent egress rule uses the selected inner source pool', () => {
    const { result, calls } = run(
      `
select_inner_docker_pool
_IPTABLES='${join(bin, 'iptables')}'
TALE_EGRESS_IP='172.31.0.2'
TALE_EGRESS_PORT='3128'
rm() { :; }
setup_inner_transparent_egress
`,
      { TALE_NETWORK_TEST_ROUTES: '[{"dst":"172.31.0.0/16","dev":"eth0"}]' },
    );
    expect(result.status).toBe(0);
    expect(calls).toContain(
      '-t nat -A PREROUTING -s 172.16.0.0/16 -p tcp -j REDSOCKS',
    );
    expect(calls).not.toContain('-s 172.31.0.0/16');
  });
  test('dockerd receives the selected bip and address pool before any readiness work', () => {
    const { result, calls } = run(
      `
setup_cgroup_nesting() { :; }
resolve_egress_endpoint() { TALE_EGRESS_IP=''; }
apply_inner_egress_fence() { :; }
protect_shared_cache_network() { :; }
setup_inner_transparent_egress() { printf 'egress %s\\n' "$TALE_DIND_INNER_POOL" >> "$TALE_NETWORK_TEST_LOG"; }
mkdir() { :; }
trap '[ -z "\${TALE_DOCKERD_PID:-}" ] || kill "$TALE_DOCKERD_PID" 2>/dev/null || true' EXIT
start_inner_dockerd
`,
      { TALE_NETWORK_TEST_ROUTES: '[{"dst":"172.31.0.0/16","dev":"eth0"}]' },
    );
    expect(result.status).toBe(0);
    expect(calls).toContain('--bip=172.16.0.1/24');
    expect(calls).toContain(
      '--default-address-pool base=172.16.0.0/16,size=24',
    );
    expect(calls).toContain('egress 172.16.0.0/16');
    expect(calls.indexOf('dockerd ')).toBeLessThan(calls.indexOf('egress '));
  });
});
