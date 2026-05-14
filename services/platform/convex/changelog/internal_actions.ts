'use node';

import { v } from 'convex/values';
import { JSDOM } from 'jsdom';

import { internalAction } from '../_generated/server';

// We scrape the public web HTML at github.com/.../releases instead of going
// through api.github.com to dodge the 60-req/hour unauthenticated rate limit
// — the web path is CDN-served and the only practical way to get paginated
// release notes without a token. The atom feed alternative was capped at 10
// entries and ignored `?page=N`, so it couldn't cover users who skipped many
// versions. HTML structure is less stable than an API contract; expect to
// revisit the selectors if GitHub redesigns the releases page.
const RELEASES_PAGE_URL = 'https://github.com/tale-project/tale/releases';
const RELEASE_TAG_URL_PREFIX =
  'https://github.com/tale-project/tale/releases/tag/';

const releaseShape = v.object({
  tag: v.string(),
  version: v.string(),
  name: v.union(v.string(), v.null()),
  body: v.union(v.string(), v.null()),
  htmlUrl: v.string(),
  publishedAt: v.union(v.string(), v.null()),
});

interface ParsedRelease {
  tag: string;
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

// Match a leading `vX.Y.Z` (or `X.Y.Z`) with optional `-rc1` prerelease
// suffix. Captures the version token; the rest of the h1 is treated as
// the release name.
const VERSION_HEAD_RE = /^(v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/;

function parseReleasesHtml(html: string): ParsedRelease[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Each release renders as a `.markdown-body` div tagged with
  // `data-test-selector="body-content"`. The first child is an `<h1>` whose
  // text starts with the tag (e.g. `v0.2.72 — Title`).
  const bodies = doc.querySelectorAll(
    'div[data-test-selector="body-content"].markdown-body',
  );

  const results: ParsedRelease[] = [];
  for (const body of Array.from(bodies)) {
    const h1 = body.querySelector('h1');
    if (!h1) continue;

    const titleText = h1.textContent?.trim() ?? '';
    const tagMatch = VERSION_HEAD_RE.exec(titleText);
    if (!tagMatch) continue;

    const tag = tagMatch[1];
    const version = tag.replace(/^v/, '');
    // The remainder of the h1 after the version (and an em-dash separator)
    // is a human-friendly title; fall back to the version if there isn't one.
    const rest = titleText
      .slice(tagMatch[0].length)
      .replace(/^\s*[—–-]\s*/, '');
    const name = rest.length > 0 ? rest : null;

    // Strip the leading <h1> from the body via string replace so we don't
    // need to clone the DOM (and avoids the cloneNode → Element cast).
    const bodyHtml = body.innerHTML
      .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '')
      .trim();

    // Each release section is wrapped in a `.Box`. Limit the relative-time
    // lookup to that ancestor so we don't pick up a sibling release's date.
    let datetime: string | null = null;
    let scope: Element | null = body.parentElement;
    let walks = 0;
    while (scope && walks < 8) {
      if (scope.classList?.contains('Box')) {
        const time = scope.querySelector('relative-time[datetime]');
        datetime = time?.getAttribute('datetime') ?? null;
        break;
      }
      scope = scope.parentElement;
      walks++;
    }

    results.push({
      tag,
      version,
      name,
      body: bodyHtml.length > 0 ? bodyHtml : null,
      htmlUrl: `${RELEASE_TAG_URL_PREFIX}${encodeURIComponent(tag)}`,
      publishedAt: datetime,
    });
  }

  return results;
}

export const fetchReleasesPageUncached = internalAction({
  args: { page: v.number() },
  returns: v.array(releaseShape),
  handler: async (_ctx, { page }) => {
    const url =
      page === 1 ? RELEASES_PAGE_URL : `${RELEASES_PAGE_URL}?page=${page}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        // GitHub serves a stripped/JS-shell page to obvious bots. Use a
        // browser-style UA so we get the fully-rendered HTML.
        'User-Agent':
          'Mozilla/5.0 (compatible; tale-platform/1.0; +https://github.com/tale-project/tale)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Pages past the end of history return 404 once we've exhausted the
      // available releases. Page 1 failing is a real error; later pages
      // just yield an empty array so the orchestrator stops paging.
      if (page > 1 && response.status === 404) return [];
      const errorText = await response.text().catch(() => '');
      console.error(
        `GitHub releases page ${page} failed: ${response.status} ${errorText.slice(0, 200)}`,
      );
      if (page === 1) {
        throw new Error(`GitHub releases page failed: ${response.status}`);
      }
      return [];
    }

    const html = await response.text();
    return parseReleasesHtml(html);
  },
});
