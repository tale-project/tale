import { afterEach, describe, expect, mock, test } from 'bun:test';

import { getAvailableVersions } from './get-available-versions';

const fetchMock = mock();
// @ts-expect-error -- Bun mock does not satisfy the full fetch type signature
globalThis.fetch = fetchMock;

mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  debug: mock(),
  warn: mock(),
}));

afterEach(() => {
  fetchMock.mockReset();
});

function mockTokenResponse() {
  return Response.json({ token: 'ghp_fake_token_with_enough_length_to_pass' });
}

function mockTagsResponse(tags: string[]) {
  return Response.json({ name: 'tale-project/tale/tale-platform', tags });
}

function mockManifestHead(digest: string | null) {
  if (!digest) {
    return new Response(null, { status: 404 });
  }
  return new Response(null, {
    status: 200,
    headers: { 'docker-content-digest': digest },
  });
}

describe('getAvailableVersions', () => {
  test('returns empty list for unparseable registry', async () => {
    const result = await getAvailableVersions('invalid-registry', 10);

    expect(result.versions).toEqual([]);
    expect(result.error).toBe('unknown');
  });

  test('returns network error when token fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 10);

    expect(result.versions).toEqual([]);
    expect(result.error).toBe('network');
  });

  test('filters out versions without a manifest', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      // Token request
      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      // Tags list
      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(
          mockTagsResponse([
            '0.2.16',
            '0.2.16-amd64',
            '0.2.16-arm64',
            '0.2.15',
            '0.2.15-amd64',
            '0.2.15-arm64',
            '0.2.14',
          ]),
        );
      }

      // Manifest HEAD requests
      if (options?.method === 'HEAD') {
        // 0.2.16 has no manifest yet (still building)
        if (urlStr.includes('/0.2.16')) {
          return Promise.resolve(mockManifestHead(null));
        }
        // 0.2.15 has a manifest
        if (urlStr.includes('/0.2.15')) {
          return Promise.resolve(mockManifestHead('sha256:abc'));
        }
        // 0.2.14 has a manifest
        if (urlStr.includes('/0.2.14')) {
          return Promise.resolve(mockManifestHead('sha256:def'));
        }
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 10);

    const tags = result.versions.map((v) => v.tag);
    expect(tags).not.toContain('0.2.16');
    expect(tags).toContain('0.2.15');
    expect(tags).toContain('0.2.14');
  });

  test('includes versions with valid manifests', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(mockTagsResponse(['0.2.16', '0.2.15']));
      }

      if (options?.method === 'HEAD') {
        return Promise.resolve(mockManifestHead('sha256:valid'));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 10);

    const tags = result.versions.map((v) => v.tag);
    expect(tags).toContain('0.2.16');
    expect(tags).toContain('0.2.15');
  });

  test('filters out arch-suffixed tags from version list', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(
          mockTagsResponse(['0.2.16', '0.2.16-amd64', '0.2.16-arm64']),
        );
      }

      if (options?.method === 'HEAD') {
        return Promise.resolve(mockManifestHead('sha256:valid'));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 10);

    const tags = result.versions.map((v) => v.tag);
    expect(tags).not.toContain('0.2.16-amd64');
    expect(tags).not.toContain('0.2.16-arm64');
    expect(tags).toContain('0.2.16');
  });

  test('includes latest tag with alias when digest matches', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(
          mockTagsResponse(['latest', '0.2.16', '0.2.15']),
        );
      }

      if (options?.method === 'HEAD') {
        return Promise.resolve(mockManifestHead('sha256:same'));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 10);

    const latestEntry = result.versions.find((v) => v.tag === 'latest');
    expect(latestEntry).toBeDefined();
    expect(latestEntry?.aliases).toContain('0.2.16');
  });

  test('respects limit parameter', async () => {
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(
          mockTagsResponse(['0.3.0', '0.2.16', '0.2.15', '0.2.14', '0.2.13']),
        );
      }

      if (options?.method === 'HEAD') {
        return Promise.resolve(mockManifestHead('sha256:valid'));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 3);

    expect(result.versions.length).toBeLessThanOrEqual(3);
  });

  test('backfills past missing manifests to satisfy limit', async () => {
    // Newest 3 tags have no manifest; the next 3 do.
    // With limit=3 the result must skip the broken tags and return the older valid ones.
    const tagsWithMissing = [
      '0.4.0',
      '0.3.2',
      '0.3.1',
      '0.3.0',
      '0.2.16',
      '0.2.15',
    ];
    const missingManifestTags = new Set(['0.4.0', '0.3.2', '0.3.1']);

    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/token')) {
        return Promise.resolve(mockTokenResponse());
      }

      if (urlStr.includes('/tags/list')) {
        return Promise.resolve(mockTagsResponse(tagsWithMissing));
      }

      if (options?.method === 'HEAD') {
        for (const tag of missingManifestTags) {
          if (urlStr.includes(`/${tag}`)) {
            return Promise.resolve(mockManifestHead(null));
          }
        }
        return Promise.resolve(mockManifestHead('sha256:valid'));
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 3);

    const tags = result.versions.map((v) => v.tag);
    expect(tags).toEqual(['0.3.0', '0.2.16', '0.2.15']);
  });
});
