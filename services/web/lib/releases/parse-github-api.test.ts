import { describe, expect, it } from 'vitest';

import { mapGithubApiRelease, mapGithubApiReleases } from './parse-github-api';

describe('mapGithubApiRelease', () => {
  it('maps a standard release', () => {
    const release = mapGithubApiRelease({
      tag_name: 'v0.3.3',
      name: 'Tale v0.3.3 — Streaming tool calls',
      body: '## Highlights\n\n- Faster tools',
      html_url: 'https://github.com/tale-project/tale/releases/tag/v0.3.3',
      published_at: '2026-07-01T12:00:00Z',
      draft: false,
    });
    expect(release).toEqual({
      tag: 'v0.3.3',
      version: '0.3.3',
      name: 'Streaming tool calls',
      body: '## Highlights\n\n- Faster tools',
      htmlUrl: 'https://github.com/tale-project/tale/releases/tag/v0.3.3',
      publishedAt: '2026-07-01T12:00:00Z',
    });
  });

  it('skips drafts', () => {
    expect(
      mapGithubApiRelease({
        tag_name: 'v0.0.0',
        draft: true,
      }),
    ).toBeNull();
  });

  it('dedupes by tag', () => {
    const list = mapGithubApiReleases([
      { tag_name: 'v1.0.0', body: 'a' },
      { tag_name: 'v1.0.0', body: 'b' },
      { tag_name: 'v0.9.0', body: 'c' },
    ]);
    expect(list.map((r) => r.tag)).toEqual(['v1.0.0', 'v0.9.0']);
  });
});
