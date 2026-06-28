// The shared-buildkitd naming seam. v1 returns ONE global daemon, but the
// helpers take organizationId so per-org isolation later is a name change here
// with no caller churn. These tests pin the v1 names + the org-id safety guard.

import { describe, expect, test } from 'bun:test';

import {
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdEndpoint,
  buildkitdMirrorContainerName,
  buildkitdMirrorRef,
  EGRESS_READY_MARKER,
  MIRROR_REGISTRIES,
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
  // exact marker path the buildkitd entrypoint writes. A drift here would make
  // ensureBuildkitd think every healthy daemon is broken (recreate-loop) or
  // every broken one is healthy (the original silent-no-internet bug).
  test('egress-ready marker path matches the buildkitd entrypoint', async () => {
    const entrypoint = await Bun.file(
      new URL('../../sandbox-buildkitd/docker-entrypoint.sh', import.meta.url),
    ).text();
    expect(EGRESS_READY_MARKER).toMatch(/^\/[\w./-]+$/);
    expect(entrypoint).toContain(`EGRESS_READY=${EGRESS_READY_MARKER}`);
  });
});
