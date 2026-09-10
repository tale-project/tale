// Organization isolation and resource naming for persistent build caches.

import { describe, expect, test } from 'bun:test';

import {
  BUILDKITD_LIVE_TOML,
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  EGRESS_READY_MARKER,
  egressProxyHostname,
  firstIpv4,
  MIRROR_REGISTRIES,
  parseDnsNameserver,
} from './buildkitd.ts';

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
