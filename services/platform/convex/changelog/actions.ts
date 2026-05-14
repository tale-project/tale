import { v } from 'convex/values';

import { compareVersions } from '../../lib/compare-versions';
import { action } from '../_generated/server';
import { githubReleasesPageCache } from '../lib/action_cache';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

const releaseShape = v.object({
  tag: v.string(),
  version: v.string(),
  name: v.union(v.string(), v.null()),
  body: v.union(v.string(), v.null()),
  htmlUrl: v.string(),
  publishedAt: v.union(v.string(), v.null()),
});

interface Release {
  tag: string;
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

// Cap how far back we'll page. 3 × 10 = 30 most recent releases covers
// users who've skipped a handful of upgrades; anyone older falls through
// to the "view on GitHub" card in the UI.
const MAX_PAGES = 3;

export const listReleases = action({
  args: { from: v.optional(v.string()) },
  returns: v.array(releaseShape),
  handler: async (ctx, { from }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const collected: Release[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      // Page-1 failures bubble (nothing to show anyway). Page>1 failures
      // degrade gracefully: log + break with whatever we collected from
      // earlier pages, so a transient github.com hiccup doesn't blank the
      // entire viewer for users only needing the latest releases.
      let releases: Release[];
      try {
        releases = await githubReleasesPageCache.fetch(ctx, { page });
      } catch (err) {
        if (page === 1) throw err;
        console.warn(
          `changelog: page ${page} fetch failed, returning partial`,
          err,
        );
        break;
      }
      if (releases.length === 0) break;

      for (const r of releases) {
        if (seen.has(r.tag)) continue;
        seen.add(r.tag);
        collected.push(r);
      }

      // No `from` to chase — one page is enough.
      if (!from) break;

      // GitHub orders releases newest-first within a page, so the page's
      // last entry is its oldest. Stop once we've reached past `from`.
      const oldest = releases[releases.length - 1].version;
      try {
        if (compareVersions(oldest, from) <= 0) break;
      } catch (err) {
        console.warn(
          `changelog: unparseable version while paging (oldest=${oldest}, from=${from})`,
          err,
        );
        break;
      }
    }

    return collected;
  },
});
