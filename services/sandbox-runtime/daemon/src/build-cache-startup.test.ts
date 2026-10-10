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
import { dirname, join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tale-build-startup-'));
const log = join(root, 'calls');
const bin = join(root, 'bin');
mkdirSync(bin);
const home = join(root, 'home');
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
// Hosts without coreutils' sha256sum (older macOS) get the same digest from
// shasum, so the helper runs unchanged.
if (!Bun.which('sha256sum'))
  writeFileSync(join(bin, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256\n', {
    mode: 0o755,
  });
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
  .replaceAll('/usr/bin/setpriv', join(bin, 'setpriv'))
  .replaceAll('/usr/bin/docker', join(bin, 'docker'))
  .replaceAll('/agent/.runtime/home', home)
  .replaceAll('/proc/sys/net/ipv6', ipv6)
  .replaceAll('/var/log/buildx-create.log', join(root, 'buildx-create.log'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const endpoint = 'tcp://tale-buildkitd-0123456789abcdef01234567:1234';
// The name earlier runtimes derived with node; persistent workspaces hold it.
function nodeBuilderName(value: string): string {
  return `tale-build-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}
const builder = nodeBuilderName(endpoint);
const instance = join(home, '.docker/buildx/instances', builder);

function run(command: string, env: Record<string, string> = {}) {
  writeFileSync(log, '');
  rmSync(home, { recursive: true, force: true });
  const definitions: Record<string, string> = {
    // The shape buildx writes: the builder's name and its node's endpoint.
    file: JSON.stringify({
      Name: builder,
      Driver: 'remote',
      Nodes: [{ Name: `${builder}0`, Endpoint: endpoint }],
    }),
    empty: '',
    foreign: JSON.stringify({
      Name: builder,
      Driver: 'remote',
      Nodes: [{ Name: `${builder}0`, Endpoint: 'tcp://elsewhere:1234' }],
    }),
  };
  const definition = definitions[env.TALE_BUILD_TEST_INSTANCE ?? ''];
  if (definition !== undefined) {
    mkdirSync(dirname(instance), { recursive: true });
    writeFileSync(instance, definition);
  } else if (env.TALE_BUILD_TEST_INSTANCE === 'directory') {
    mkdirSync(instance, { recursive: true });
  }
  for (const profile of ['all', 'default', 'eth0']) {
    rmSync(join(ipv6, `conf/${profile}/disable_ipv6`), {
      recursive: true,
      force: true,
    });
    writeFileSync(
      join(ipv6, `conf/${profile}/disable_ipv6`),
      profile === 'eth0'
        ? (env.TALE_BUILD_TEST_INTERFACE_DISABLED ?? '0')
        : (env.TALE_BUILD_TEST_IPV6_DISABLED ?? '0'),
    );
  }
  if (env.TALE_BUILD_TEST_IPV6_UNAVAILABLE === '1') {
    rmSync(join(ipv6, 'conf/default/disable_ipv6'));
    mkdirSync(join(ipv6, 'conf/default/disable_ipv6'));
  }
  const result = spawnSync('/bin/sh', ['-c', `${helpers}\n${command}`], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      TALE_BUILDKITD_ENDPOINT: endpoint,
      TALE_BUILD_TEST_LOG: log,
      BUILDX_BUILDER: 'tale-shared',
      BUILDX_CONFIG: '',
      DOCKER_CONFIG: '',
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
  test('the shell derives the same builder name node did', () => {
    const endpoints = [
      endpoint,
      'tcp://tale-buildkitd-ffffffffffffffffffffffff:1234',
      'tcp://a:1',
      'tcp://tale-buildkitd-org_with-under.score:65535',
    ];
    const { result } = run(
      endpoints
        .map((value) => `_shared_buildx_builder_name '${value}'`)
        .join('\n'),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(
      endpoints.map(nodeBuilderName),
    );
  });
  test('a resumed workspace that owns the definition selects it without running buildx', () => {
    const { result, calls } = run(select, { TALE_BUILD_TEST_INSTANCE: 'file' });
    expect(result.status).toBe(0);
    expect(calls).toEqual(['']);
    expect(result.stdout).toContain(`SELECTED=${builder}`);
  });
  test.each(['empty', 'foreign'])(
    'a %s definition goes through buildx, which rejects a broken builder',
    (kind) => {
      const { result, calls } = run(select, {
        TALE_BUILD_TEST_INSTANCE: kind,
        TALE_BUILD_TEST_REUSE: '1',
      });
      expect(result.status).toBe(0);
      expect(calls).toEqual([`buildx inspect ${builder}`]);
      expect(result.stdout).toContain(`SELECTED=${builder}`);
    },
  );
  test('anything but a regular definition file falls back to inspect', () => {
    const { result, calls } = run(select, {
      TALE_BUILD_TEST_INSTANCE: 'directory',
      TALE_BUILD_TEST_REUSE: '1',
    });
    expect(result.status).toBe(0);
    expect(calls).toEqual([`buildx inspect ${builder}`]);
    expect(result.stdout).toContain(`SELECTED=${builder}`);
  });
  test('a failing digest leaves the local daemon selected and never aborts boot', () => {
    const { result, calls } = run(
      `sha256sum() { return 1; }\nset -e\n${select}\nprintf 'BOOTED\\n'`,
    );
    expect(result.status).toBe(0);
    expect(calls).toEqual(['']);
    expect(result.stdout).toContain('SELECTED=default');
    expect(result.stdout).toContain('BOOTED');
    expect(result.stderr).toContain('could not set up shared buildx builder');
  });
  test('a failing create under set -e still boots on the local daemon', () => {
    const { result } = run(`set -e\n${select}\nprintf 'BOOTED\\n'`, {
      TALE_BUILD_TEST_CREATE_FAIL: '1',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SELECTED=default');
    expect(result.stdout).toContain('BOOTED');
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
  test('keeps the outer guard first without growing duplicates across engine starts', () => {
    const state = join(root, 'forward-rules');
    const guard =
      '-A FORWARD -i eth+ -m conntrack ! --ctstate RELATED,ESTABLISHED -j DROP';
    writeFileSync(state, `-A FORWARD -j DOCKER-USER\n${guard}\n${guard}\n`);
    const { result } = run(`
firewall() {
  case "$1" in
    -S) cat '${state}' ;;
    -I) { printf '%s\\n' '${guard}'; cat '${state}'; } > '${state}.next'; mv '${state}.next' '${state}' ;;
    -D) sed "\${3}d" '${state}' > '${state}.next'; mv '${state}.next' '${state}' ;;
    *) exit 1 ;;
  esac
}
_ensure_outer_forward_guard firewall
_ensure_outer_forward_guard firewall
cat '${state}'
`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      guard,
      '-A FORWARD -j DOCKER-USER',
    ]);
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
    expect(enabledInterface.result.status).toBe(0);
    expect(enabledInterface.result.stdout).toContain('GUARDED');
    expect(
      readFileSync(join(ipv6, 'conf/eth0/disable_ipv6'), 'utf8').trim(),
    ).toBe('1');
  });

  test('unfilterable IPv6 with unverifiable namespace settings still refuses cache attachment', () => {
    const { result } = run(protect, {
      TALE_BUILD_TEST_FIREWALL_FAIL: 'ip6tables -L FORWARD',
      TALE_BUILD_TEST_IPV6_UNAVAILABLE: '1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('enable IPv6 netfilter');
    expect(result.stdout).not.toContain('GUARDED');
  });

  test('without shared cache there are no extra network guard calls', () => {
    const { result, calls } = run(protect, { TALE_BUILDKITD_ENDPOINT: '' });
    expect(result.status).toBe(0);
    expect(calls).toEqual(['']);
  });
});
