import { afterEach, describe, expect, mock, test } from 'bun:test';

const fetchMock = mock();
// @ts-expect-error -- mock does not include the `preconnect` property added in newer Bun types
globalThis.fetch = fetchMock;

mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: mock(),
  debug: mock(),
}));

const { getAvailableVersions } = await import('./get-available-versions');

function mockFetchResponses(
  tags: string[],
  options: {
    manifestResults?: Record<string, boolean>;
    digestMap?: Record<string, string>;
  } = {},
) {
  const { manifestResults = {}, digestMap = {} } = options;

  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    const urlStr = String(url);

    // Token requests
    if (urlStr.includes('/token?')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: 'mock-token-valid-length-xxx' }),
      });
    }

    // Tags list request
    if (urlStr.includes('/tags/list')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'test', tags }),
      });
    }

    // Manifest HEAD requests
    if (opts?.method === 'HEAD' && urlStr.includes('/manifests/')) {
      const tag = urlStr.split('/manifests/')[1];
      const image = urlStr
        .replace('https://ghcr.io/v2/', '')
        .split('/manifests/')[0];

      // Check service-specific manifest availability
      const key = `${image}:${tag}`;
      if (key in manifestResults) {
        if (manifestResults[key]) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({
              'docker-content-digest':
                digestMap[tag] ?? `sha256:${tag}-${image}`,
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      }

      // Default: all manifests exist with tag-based digest (or custom digest)
      return Promise.resolve({
        ok: true,
        headers: new Headers({
          'docker-content-digest': digestMap[tag] ?? `sha256:${tag}-digest`,
        }),
      });
    }

    return Promise.resolve({ ok: false, status: 404 });
  });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe('getAvailableVersions', () => {
  test('returns sorted semantic versions', async () => {
    mockFetchResponses(['0.2.14', '0.2.15', '0.2.16']);

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    expect(result.error).toBeUndefined();
    expect(result.versions.length).toBeGreaterThan(0);
    expect(result.versions[0].tag).toBe('0.2.16');
  });

  test('filters out arch-suffixed tags', async () => {
    mockFetchResponses(['0.2.16', '0.2.16-amd64', '0.2.16-arm64', '0.2.15']);

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    const tags = result.versions.map((v) => v.tag);
    expect(tags).not.toContain('0.2.16-amd64');
    expect(tags).not.toContain('0.2.16-arm64');
  });

  test('excludes versions with incomplete manifests', async () => {
    mockFetchResponses(['0.2.16', '0.2.15', '0.2.14'], {
      manifestResults: {
        // 0.2.16 is missing the crawler manifest
        'tale-project/tale/tale-platform:0.2.16': true,
        'tale-project/tale/tale-rag:0.2.16': true,
        'tale-project/tale/tale-crawler:0.2.16': false,
        'tale-project/tale/tale-db:0.2.16': true,
        'tale-project/tale/tale-proxy:0.2.16': true,
      },
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    const tags = result.versions.map((v) => v.tag);
    expect(tags).not.toContain('0.2.16');
    expect(tags).toContain('0.2.15');
  });

  test('includes versions with all manifests present', async () => {
    mockFetchResponses(['0.2.16', '0.2.15']);

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    const tags = result.versions.map((v) => v.tag);
    expect(tags).toContain('0.2.16');
    expect(tags).toContain('0.2.15');
  });

  test('returns error for invalid registry URL', async () => {
    const result = await getAvailableVersions('docker.io/invalid');

    expect(result.versions).toEqual([]);
    expect(result.error).toBe('unknown');
  });

  test('returns network error when token fetch fails', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401 }),
    );

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    expect(result.versions).toEqual([]);
    expect(result.error).toBe('network');
  });

  test('handles latest tag with semantic alias', async () => {
    mockFetchResponses(['latest', '0.2.16', '0.2.15'], {
      digestMap: {
        latest: 'sha256:shared-digest',
        '0.2.16': 'sha256:shared-digest',
      },
    });

    const result = await getAvailableVersions('ghcr.io/tale-project/tale');

    const latestVersion = result.versions.find((v) => v.tag === 'latest');
    expect(latestVersion).toBeDefined();
    expect(latestVersion?.aliases).toContain('0.2.16');
  });

  test('respects version limit', async () => {
    mockFetchResponses([
      '0.2.20',
      '0.2.19',
      '0.2.18',
      '0.2.17',
      '0.2.16',
      '0.2.15',
    ]);

    const result = await getAvailableVersions('ghcr.io/tale-project/tale', 3);

    expect(result.versions.length).toBeLessThanOrEqual(3);
  });
});
