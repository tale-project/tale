'use node';

import { v } from 'convex/values';

import { fetchJson } from '../../lib/utils/type-cast-helpers';
import { internalAction } from '../_generated/server';

// api.github.com supports per_page up to 100 in a single request. Atom feed
// was explored as an alternative to dodge the 60/hr unauthenticated rate
// limit, but its `?page=N` parameter is ignored — only the 10 most recent
// releases are ever returned, which can't cover a user multiple versions
// behind. With a 1h ActionCache per deployment IP, ≥10 unique deployments
// would need to thrash the cache for the rate limit to bite.
const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/tale-project/tale/releases?per_page=100';

interface RawRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

const releaseShape = v.object({
  tag: v.string(),
  version: v.string(),
  name: v.union(v.string(), v.null()),
  body: v.union(v.string(), v.null()),
  htmlUrl: v.string(),
  publishedAt: v.union(v.string(), v.null()),
});

export const fetchReleasesUncached = internalAction({
  args: {},
  returns: v.array(releaseShape),
  handler: async () => {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tale-platform',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(
        `GitHub releases fetch failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
      throw new Error(`GitHub releases fetch failed: ${response.status}`);
    }

    const raw = await fetchJson<RawRelease[]>(response);
    return raw
      .filter((r) => !r.draft && !r.prerelease)
      .map((r) => ({
        tag: r.tag_name,
        version: r.tag_name.replace(/^v/, ''),
        name: r.name,
        body: r.body,
        htmlUrl: r.html_url,
        publishedAt: r.published_at,
      }));
  },
});
