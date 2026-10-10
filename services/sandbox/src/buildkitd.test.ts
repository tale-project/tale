// Organization isolation and resource naming for persistent build caches.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUILDKITD_LIVE_TOML,
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  buildkitHelperLimits,
  buildkitMirrorEnvironment,
  EGRESS_READY_MARKER,
  egressProxyHostname,
  firstIpv4,
  helperStamp,
  MIRROR_REGISTRIES,
  parseDnsNameserver,
  parseFenceProbe,
  buildkitCacheBudget,
  builderConfiguration,
  builderLaunchDrifted,
  builderLaunchRecord,
} from './buildkitd.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';

const LIMITS_CFG = { session: TEST_SESSION_CONFIG };

describe('buildkitd naming seam', () => {
  test('all build resources are stable per org and distinct across orgs', () => {
    const ids = [
      'org-a',
      'org-b',
      'ORG-A',
      'org_a',
      'a'.repeat(127) + '1',
      'a'.repeat(127) + '2',
    ];
    for (const naming of [
      buildkitdContainerName,
      buildkitdCacheVolumeName,
      buildkitdNetworkName,
      buildkitdEndpoint,
    ]) {
      expect(new Set(ids.map(naming)).size).toBe(ids.length);
      expect(naming('org-a')).toBe(naming('org-a'));
    }
    expect(buildkitdContainerName('org-a')).not.toBe('tale-buildkitd');
    expect(buildkitdCacheVolumeName('org-a')).not.toBe('tale-buildkitd-cache');
    expect(buildkitdContainerName('a'.repeat(128))).toMatch(
      /^[a-z0-9-]{1,63}$/,
    );
  });

  test('unchanged helpers retain their deployed configuration stamp', () => {
    const image = 'mirror:1';
    const limits = ['--cpus', '1', '--memory', '128m'];
    const deployed = createHash('sha256')
      .update([image, ...limits].join('\n'))
      .digest('hex')
      .slice(0, 16);
    expect(helperStamp(image, limits)).toBe(deployed);
    expect(helperStamp(image, limits, ['solver-parallelism=1'])).not.toBe(
      deployed,
    );
  });

  test('endpoint is a well-formed tcp://host:port (matches the args ENDPOINT_RE)', () => {
    expect(buildkitdEndpoint('whatever')).toMatch(
      /^tcp:\/\/[a-zA-Z0-9_.-]{1,128}:[0-9]{1,5}$/,
    );
  });

  test('rejects an unsafe organizationId (injection guard)', () => {
    for (const bad of ['', 'a b', 'a/b', '../x', 'a;rm', 'a'.repeat(129)]) {
      expect(() => buildkitdContainerName(bad)).toThrow(
        /refusing unsafe organizationId/,
      );
      expect(() => buildkitdCacheVolumeName(bad)).toThrow(
        /refusing unsafe organizationId/,
      );
      expect(() => buildkitdEndpoint(bad)).toThrow(
        /refusing unsafe organizationId/,
      );
    }
  });

  test('accepts a normal organizationId', () => {
    expect(() => buildkitdContainerName('org_123-AB')).not.toThrow();
  });

  test('registry caches and endpoints are organization-scoped and DNS-safe', () => {
    expect(MIRROR_REGISTRIES).toEqual(['docker.io', 'ghcr.io', 'quay.io']);
    for (const registry of MIRROR_REGISTRIES) {
      const name = buildkitdMirrorContainerName('org-a', registry);
      expect(buildkitdMirrorRef('org-a', registry)).toBe(`${name}:5000`);
      expect(buildkitdMirrorContainerName('org-b', registry)).not.toBe(name);
      expect(buildkitdMirrorVolumeName('org-a', registry)).not.toBe(
        buildkitdMirrorVolumeName('org-b', registry),
      );
      expect(buildkitdMirrorContainerName('a'.repeat(128), registry)).toMatch(
        /^[a-z0-9-]{1,63}$/,
      );
    }
    expect(() => buildkitdMirrorRef('org-a', 'docker-io')).toThrow(
      /unsupported mirror registry/,
    );
    expect(() => buildkitdMirrorRef('../org', 'docker.io')).toThrow(
      /unsafe organizationId/,
    );
  });

  // The egress-health probe is a cross-file contract: the spawner probes the
  // exact marker path AND reads the live config the buildkitd entrypoint writes.
  // A drift here would make ensureBuildkitd think every healthy daemon is broken
  // (recreate-loop) or every broken one is healthy (the silent-no-internet bug).
  test('egress-ready marker + live-config paths match the buildkitd entrypoint', async () => {
    const entrypoint = await Bun.file(
      new URL('../../sandbox-buildkitd/docker-entrypoint.sh', import.meta.url),
    ).text();
    expect(EGRESS_READY_MARKER).toMatch(/^\/[\w./-]+$/);
    expect(entrypoint).toContain(`EGRESS_READY=${EGRESS_READY_MARKER}`);
    expect(BUILDKITD_LIVE_TOML).toMatch(/^\/[\w./-]+$/);
    expect(entrypoint).toContain(`LIVE_TOML=${BUILDKITD_LIVE_TOML}`);
  });

  test('the transparent proxy uses the helper’s bounded Docker log', async () => {
    const entrypoint = await Bun.file(
      new URL('../../sandbox-buildkitd/docker-entrypoint.sh', import.meta.url),
    ).text();
    expect(entrypoint).toMatch(/^\s*redsocks -c \/tmp\/redsocks.conf >&2 &$/m);
    expect(entrypoint).not.toContain('/tmp/redsocks.log');
    expect(buildkitHelperLimits(LIMITS_CFG, 'builder')).toEqual(
      expect.arrayContaining([
        '--log-driver=json-file',
        'max-size=10m',
        'max-file=1',
      ]),
    );
  });
});

describe('buildkitd helper bounds', () => {
  test('the operator sets the builder’s CPUs and memory; mirrors stay small', () => {
    const cfg = {
      ...LIMITS_CFG,
      buildkitdCpus: 6,
      buildkitdMemoryBytes: 12 * 1024 ** 3,
    };
    expect(buildkitHelperLimits(cfg, 'builder')).toEqual(
      expect.arrayContaining([
        '--cpus=6',
        '--memory=12288m',
        '--memory-swap=12288m',
      ]),
    );
    expect(buildkitHelperLimits(cfg, 'mirror')).toEqual(
      expect.arrayContaining(['--cpus=1', '--memory=512m']),
    );
  });

  test('helpers run at an agent session’s CPU weight, which a busy helper takes in place', () => {
    for (const role of ['builder', 'mirror'] as const) {
      expect(
        buildkitHelperLimits(LIMITS_CFG, role).filter((flag) =>
          flag.startsWith('--cpu-shares='),
        ),
      ).toEqual(['--cpu-shares=256']);
    }
    const tuned = {
      session: {
        ...TEST_SESSION_CONFIG,
        agentProfile: { ...TEST_SESSION_CONFIG.agentProfile, cpuShares: 64 },
      },
    };
    const limits = buildkitHelperLimits(tuned, 'builder');
    expect(limits).toContain('--cpu-shares=64');
    expect(helperStamp('buildkit:1', limits)).not.toBe(
      helperStamp('buildkit:1', buildkitHelperLimits(LIMITS_CFG, 'builder')),
    );
  });

  test('a stamp changes with the image and with the bounds', () => {
    const limits = buildkitHelperLimits(LIMITS_CFG, 'builder');
    const stamp = helperStamp('buildkit:1', limits);
    expect(stamp).toMatch(/^[a-f0-9]{16}$/);
    expect(helperStamp('buildkit:1', limits)).toBe(stamp);
    expect(helperStamp('buildkit:2', limits)).not.toBe(stamp);
    expect(
      helperStamp(
        'buildkit:1',
        buildkitHelperLimits({ ...LIMITS_CFG, buildkitdCpus: 3 }, 'builder'),
      ),
    ).not.toBe(stamp);
  });
});

describe('buildkitd builder launch record', () => {
  const proxy = 'http://tale-buildkit-egress:3128/';
  const mapping = (...registries: string[]) =>
    registries
      .map((registry) => `${registry}=${buildkitdMirrorRef('org-a', registry)}`)
      .join(';');
  const full = mapping(...MIRROR_REGISTRIES);

  test('records the mapped registries and a hash of the proxy, never the proxy itself', () => {
    const secret = 'http://user:secret@tale-buildkit-egress:3128/';
    const record = builderLaunchRecord(full, secret);
    expect(record).toMatch(/^[a-f0-9]{16};docker\.io,ghcr\.io,quay\.io$/);
    expect(record).not.toContain('secret');
    // A label value Docker and simple `key=value` readers both keep whole.
    expect(record).not.toContain('=');
  });

  test('a builder launched as it would be now is current', () => {
    expect(
      builderLaunchDrifted(builderLaunchRecord(full, proxy), full, proxy),
    ).toBe(false);
  });

  test('a builder launched without a registry a mirror serves now is drifted', () => {
    const partial = builderLaunchRecord(mapping('docker.io', 'quay.io'), proxy);
    expect(builderLaunchDrifted(partial, full, proxy)).toBe(true);
    // Still without it while its mirror stays down: a recreate gains nothing.
    expect(
      builderLaunchDrifted(partial, mapping('docker.io', 'quay.io'), proxy),
    ).toBe(false);
  });

  test('a mirror down now does not drift a builder launched with it', () => {
    expect(
      builderLaunchDrifted(
        builderLaunchRecord(full, proxy),
        mapping('docker.io', 'quay.io'),
        proxy,
      ),
    ).toBe(false);
  });

  test('another proxy, or no record at all, is drift', () => {
    expect(
      builderLaunchDrifted(
        builderLaunchRecord(full, 'http://tale-buildkit-egress:3129/'),
        full,
        proxy,
      ),
    ).toBe(true);
    expect(builderLaunchDrifted(undefined, full, proxy)).toBe(true);
  });
});

describe('buildkitd cache garbage collection', () => {
  // A rule's keepDuration shields everything used more recently from that
  // rule's space limits: the old keepBytes + keepDuration rule pruned nothing
  // used within a week (measured on v0.33.1). Only a rule over all records
  // with no keepDuration caps size; its reservedSpace is the floor disk
  // pressure never prunes below.
  test('the shipped policy caps the cache and guards the shared disk', async () => {
    const toml = await Bun.file(
      new URL('../../sandbox-buildkitd/buildkitd.toml', import.meta.url),
    ).text();
    expect(toml).toMatch(/^max-parallelism = 2$/m);
    const rules = toml
      .split('[[worker.oci.gcpolicy]]')
      .slice(1)
      .map((rule) => rule.split(/\n\[/)[0] ?? '');
    expect(toml).not.toMatch(/^\s*keepBytes\s*=/m);
    const cap = rules.find((rule) => /^all\s*=\s*true/m.test(rule));
    expect(cap).toBeDefined();
    expect(cap).toMatch(/^maxUsedSpace\s*=\s*"\d+GB"/m);
    expect(cap).toMatch(/^minFreeSpace\s*=/m);
    expect(cap).toMatch(/^reservedSpace\s*=\s*"\d+GB"/m);
    expect(cap).not.toMatch(/keepDuration/);
  });
});

describe('buildkitd cache bounds', () => {
  const GIB = 1024 ** 3;
  const MIB = 1024 ** 2;
  test('a tenth of the session disk, from 1 GiB to the shipped 20 GiB', () => {
    expect(buildkitCacheBudget(null)).toEqual({
      maxUsedBytes: 20 * GIB,
      reservedBytes: 2 * GIB,
    });
    expect(buildkitCacheBudget(4096 * GIB)).toEqual({
      maxUsedBytes: 20 * GIB,
      reservedBytes: 2 * GIB,
    });
    expect(buildkitCacheBudget(100 * GIB)).toEqual({
      maxUsedBytes: 10 * GIB,
      reservedBytes: GIB,
    });
    // Whole GiB: a 75 GB disk's tenth (6.98 GiB) rounds down.
    expect(buildkitCacheBudget(75e9).maxUsedBytes).toBe(6 * GIB);
    // A total that moves by a few MiB with a pool's use keeps the same cap,
    // so the builder's stamp holds still between disk re-reads.
    const pool = 87.3 * GIB;
    expect(buildkitCacheBudget(pool + 7 * MIB)).toEqual(
      buildkitCacheBudget(pool - 5 * MIB),
    );
    expect(buildkitCacheBudget(5 * GIB)).toEqual({
      maxUsedBytes: GIB,
      reservedBytes: 102 * MIB,
    });
  });

  test('the operator’s cap wins over the disk', () => {
    expect(buildkitCacheBudget(100 * GIB, 40 * GIB)).toEqual({
      maxUsedBytes: 40 * GIB,
      reservedBytes: 2 * GIB,
    });
    expect(buildkitCacheBudget(null, 8 * GIB).maxUsedBytes).toBe(8 * GIB);
  });

  test('a builder’s stamp records its cache bounds', () => {
    const limits = buildkitHelperLimits(LIMITS_CFG, 'builder');
    const stamp = (diskBytes: number | null) =>
      helperStamp(
        'buildkit:1',
        limits,
        builderConfiguration(2, buildkitCacheBudget(diskBytes)),
      );
    expect(stamp(100 * GIB)).not.toBe(stamp(null));
    expect(stamp(4096 * GIB)).toBe(stamp(null));
  });
});

describe('buildkitd egress drift detection', () => {
  test('parseFenceProbe reads the marker, the live config and the resolution from one exec', () => {
    expect(
      parseFenceProbe(
        '#tale-fence marker 0\n#tale-fence toml\n[dns]\n  nameservers = ["172.18.0.6"]\n#tale-fence resolved\n172.18.0.6 tale-buildkit-egress\n',
      ),
    ).toEqual({
      marker: true,
      toml: '[dns]\n  nameservers = ["172.18.0.6"]',
      resolved: '172.18.0.6 tale-buildkit-egress\n',
    });
    // No marker, no config, nothing resolved: each part is still told apart.
    expect(
      parseFenceProbe(
        '#tale-fence marker 1\n#tale-fence toml\n#tale-fence resolved\n',
      ),
    ).toEqual({ marker: false, toml: '', resolved: '' });
    expect(parseFenceProbe('OCI runtime exec failed')).toBeNull();
    expect(parseFenceProbe('')).toBeNull();
  });

  test('egressProxyHostname extracts the host from the proxy URL', () => {
    expect(egressProxyHostname('http://sandbox-egress:3128')).toBe(
      'sandbox-egress',
    );
    expect(egressProxyHostname('http://10.0.0.5:3128')).toBe('10.0.0.5');
    expect(egressProxyHostname('not-a-url')).toBeNull();
    expect(egressProxyHostname('')).toBeNull();
  });

  test('firstIpv4 reads the IP from `getent hosts` output', () => {
    expect(firstIpv4('172.18.0.7      sandbox-egress\n')).toBe('172.18.0.7');
    expect(firstIpv4('  172.18.0.6 sandbox-egress sandbox-egress.tale\n')).toBe(
      '172.18.0.6',
    );
    expect(firstIpv4('')).toBeNull(); // getent found nothing
    expect(firstIpv4('sandbox-egress')).toBeNull(); // not an IP token
  });

  test('parseDnsNameserver reads the pinned [dns] IP, null when no [dns]', () => {
    const withDns = [
      '[registry."docker.io"]',
      '  mirrors = ["tale-buildkitd-mirror-docker-io:5000"]',
      '',
      '[dns]',
      '  nameservers = ["172.18.0.6"]',
      '  options = ["single-request", "ndots:0"]',
    ].join('\n');
    expect(parseDnsNameserver(withDns)).toBe('172.18.0.6');
    // No [dns] block at all (TALE_SKIP_EGRESS dev mode / unfenced boot).
    expect(parseDnsNameserver('[worker.oci]\n  enabled = true\n')).toBeNull();
    // A mirror ref must not be mistaken for a nameserver.
    expect(
      parseDnsNameserver('[registry."docker.io"]\n  mirrors = ["x:5000"]\n'),
    ).toBeNull();
  });
});

test('builder boot bounds solver parallelism and regenerates config on restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tale-buildkit-config-'));
  try {
    const script = await Bun.file(
      new URL('../../sandbox-buildkitd/docker-entrypoint.sh', import.meta.url),
    ).text();
    const init = script.match(/init_base_config\(\) \{[\s\S]*?\n\}/)?.[0];
    if (!init) throw new Error('missing config bootstrap');
    const base = new URL(
      '../../sandbox-buildkitd/buildkitd.toml',
      import.meta.url,
    ).pathname;
    const live = join(root, 'live.toml');
    for (const parallelism of ['3', '1']) {
      const child = Bun.spawn(['/bin/sh', '-c', `${init}\ninit_base_config`], {
        env: {
          ...process.env,
          BASE_TOML: base,
          LIVE_TOML: live,
          TALE_BUILDKITD_MAX_PARALLELISM: parallelism,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(await child.exited).toBe(0);
      expect(Bun.TOML.parse(await readFile(live, 'utf8'))).toMatchObject({
        worker: {
          oci: { 'max-parallelism': Number(parallelism), networkMode: 'host' },
        },
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builder boot takes the cache cap and floor the spawner sized, in bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tale-buildkit-cache-'));
  try {
    const script = await Bun.file(
      new URL('../../sandbox-buildkitd/docker-entrypoint.sh', import.meta.url),
    ).text();
    const init = script.match(/init_base_config\(\) \{[\s\S]*?\n\}/)?.[0];
    if (!init) throw new Error('missing config bootstrap');
    const base = new URL(
      '../../sandbox-buildkitd/buildkitd.toml',
      import.meta.url,
    ).pathname;
    const live = join(root, 'live.toml');
    const boot = async (env: Record<string, string>) => {
      const child = Bun.spawn(
        ['/bin/sh', '-c', `log() { :; }\n${init}\ninit_base_config`],
        {
          env: { ...process.env, BASE_TOML: base, LIVE_TOML: live, ...env },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      return child.exited;
    };
    const capRule = async () => {
      const toml: unknown = Bun.TOML.parse(await readFile(live, 'utf8'));
      const worker = Object(Object(toml).worker);
      const rules: unknown = Object(worker.oci).gcpolicy;
      return Array.isArray(rules)
        ? rules.find((rule) => Object(rule).all === true)
        : undefined;
    };
    expect(
      await boot({
        TALE_BUILDKITD_MAX_USED: '5368709120',
        TALE_BUILDKITD_RESERVED: '536870912',
      }),
    ).toBe(0);
    expect(await capRule()).toMatchObject({
      maxUsedSpace: '5368709120',
      reservedSpace: '536870912',
      minFreeSpace: '5%',
    });
    // Unset: the shipped bounds.
    expect(await boot({})).toBe(0);
    expect(await capRule()).toMatchObject({
      maxUsedSpace: '20GB',
      reservedSpace: '2GB',
    });
    for (const invalid of ['0', '5g', '-1']) {
      expect(await boot({ TALE_BUILDKITD_MAX_USED: invalid })).not.toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('buildkitd registry mirrors', () => {
  test('expire what a mirror cached two days after it was last pulled, and can delete it', () => {
    const environment = buildkitMirrorEnvironment(
      { egressProxy: 'http://tale-buildkit-egress:3128/' },
      'docker.io',
    );
    expect(environment).toContain(
      'REGISTRY_PROXY_REMOTEURL=https://registry-1.docker.io',
    );
    // Distribution v3 reads this as the proxy's blob lifetime (a week unset).
    expect(environment).toContain('REGISTRY_PROXY_TTL=48h');
    // Without deletion the expiry scheduler forgets a failed delete.
    expect(environment).toContain('REGISTRY_STORAGE_DELETE_ENABLED=true');
  });
});
