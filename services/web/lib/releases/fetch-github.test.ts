import { describe, expect, it, vi } from 'vitest';

import { fetchGithubReleases, RELEASES_PER_PAGE } from './fetch-github';

function githubRelease(tag: string): Record<string, unknown> {
  return {
    tag_name: tag,
    name: `Tale ${tag}`,
    body: 'notes',
    html_url: `https://github.com/tale-project/tale/releases/tag/${tag}`,
    published_at: '2026-08-17T07:50:16Z',
  };
}

function fullPage(prefix: string): Record<string, unknown>[] {
  return Array.from({ length: RELEASES_PER_PAGE }, (_, i) =>
    githubRelease(`${prefix}.${i}`),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `fetchGithubReleases` always calls its `fetchImpl` with a string URL, so the
 * stub can take one directly and stay assertable on headers.
 */
function stubFetch(
  handler: (url: string, init: RequestInit) => Response,
): ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Response>> {
  return vi.fn(handler);
}

function pageOf(url: string): string | null {
  return new URL(url).searchParams.get('page');
}

function headersOf(
  mock: ReturnType<typeof stubFetch>,
  call = 0,
): Record<string, string> {
  return (mock.mock.calls[call]?.[1].headers ?? {}) as Record<string, string>;
}

describe('fetchGithubReleases', () => {
  it('maps the payload and stops after a short page', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse([githubRelease('v0.4.9'), githubRelease('v0.4.8')]),
    );

    const releases = await fetchGithubReleases({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(releases.map((r) => r.version)).toEqual(['0.4.9', '0.4.8']);
  });

  it('walks up to maxPages while pages come back full', async () => {
    const fetchImpl = stubFetch((url) =>
      jsonResponse(fullPage(`p${pageOf(url)}`)),
    );

    const releases = await fetchGithubReleases({
      maxPages: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(RELEASES_PER_PAGE * 2);
  });

  it('stops early on an empty page', async () => {
    const fetchImpl = stubFetch((url) =>
      jsonResponse(pageOf(url) === '1' ? fullPage('p1') : []),
    );

    const releases = await fetchGithubReleases({
      maxPages: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(RELEASES_PER_PAGE);
  });

  it('sends the bearer token when one is configured', async () => {
    const fetchImpl = stubFetch(() => jsonResponse([githubRelease('v0.4.9')]));

    await fetchGithubReleases({
      token: 'ghp_x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(headersOf(fetchImpl).Authorization).toBe('Bearer ghp_x');
  });

  it('omits the auth header without a token', async () => {
    const fetchImpl = stubFetch(() => jsonResponse([githubRelease('v0.4.9')]));

    await fetchGithubReleases({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(headersOf(fetchImpl).Authorization).toBeUndefined();
    expect(headersOf(fetchImpl).Accept).toBe('application/vnd.github+json');
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = stubFetch(() =>
      jsonResponse({ message: 'rate limited' }, 403),
    );

    await expect(
      fetchGithubReleases({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('page 1 failed: 403');
  });

  it('throws when the payload is not an array', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ message: 'nope' }));

    await expect(
      fetchGithubReleases({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow('non-array');
  });
});
