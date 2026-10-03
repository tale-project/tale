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
  EGRESS_READY_MARKER,
  egressProxyHostname,
  firstIpv4,
  helperStamp,
  MIRROR_REGISTRIES,
  parseDnsNameserver,
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
    expect(helperStamp(image, limits, 'solver-parallelism=1')).not.toBe(
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

describe('buildkitd egress drift detection', () => {
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
