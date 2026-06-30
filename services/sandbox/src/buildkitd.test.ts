// The shared-buildkitd naming seam. v1 returns ONE global daemon, but the
// helpers take organizationId so per-org isolation later is a name change here
// with no caller churn. These tests pin the v1 names + the org-id safety guard.

import { describe, expect, test } from 'bun:test';

import {
  BUILDKITD_LIVE_TOML,
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  EGRESS_READY_MARKER,
  egressProxyHostname,
  firstIpv4,
  MIRROR_REGISTRIES,
  parseDnsNameserver,
} from './buildkitd.ts';

describe('buildkitd naming seam', () => {
  test('v1 = one global daemon, volume, and endpoint regardless of org', () => {
    expect(buildkitdContainerName('org-a')).toBe('tale-buildkitd');
    expect(buildkitdContainerName('org-b')).toBe('tale-buildkitd');
    expect(buildkitdCacheVolumeName('org-a')).toBe('tale-buildkitd-cache');
    expect(buildkitdEndpoint('org-a')).toBe('tcp://tale-buildkitd:1234');
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

  test('built-in mirrors: stable per-registry name:port (resolve as siblings)', () => {
    expect(MIRROR_REGISTRIES).toEqual(['docker.io', 'ghcr.io', 'quay.io']);
    expect(buildkitdMirrorRef('docker.io')).toBe(
      'tale-buildkitd-mirror-docker-io:5000',
    );
    expect(buildkitdMirrorRef('ghcr.io')).toBe(
      'tale-buildkitd-mirror-ghcr-io:5000',
    );
    expect(buildkitdMirrorContainerName('quay.io')).toBe(
      'tale-buildkitd-mirror-quay-io',
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
