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

const root = mkdtempSync(join(tmpdir(), 'tale-inner-network-'));
const bin = join(root, 'bin');
const log = join(root, 'calls');
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
else console.log(process.env.TALE_NETWORK_TEST_ROUTES);
`,
  { mode: 0o755 },
);
writeFileSync(
  join(bin, 'dockerd'),
  `#!/bin/sh
printf 'dockerd %s\\n' "$*" >> "$TALE_NETWORK_TEST_LOG"
exec sleep 30
`,
  { mode: 0o755 },
);
writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
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
  const result = spawnSync(
    '/bin/sh',
    ['-c', `${helpers}\n_IP='${join(bin, 'ip')}'\n${command}`],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        TALE_NETWORK_TEST_ROUTES: JSON.stringify(initialRoutes),
        TALE_NETWORK_TEST_READ_FAIL: '0',
        TALE_NETWORK_TEST_HANG: '0',
        TALE_NETWORK_TEST_OVERSIZED: '0',
        TALE_NETWORK_TEST_LOG: log,
        TALE_BUILDKITD_ENDPOINT: 'tcp://org-builder:1234',
        TALE_BUILDKIT_NETWORK_SUBNETS: '["172.19.0.0/23"]',
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
  });
});
