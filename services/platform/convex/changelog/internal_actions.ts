'use node';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';

// We scrape the public web HTML at github.com/.../releases instead of going
// through api.github.com to dodge the 60-req/hour unauthenticated rate limit
// — the web path is CDN-served and the only practical way to get paginated
// release notes without a token. The atom feed alternative was capped at 10
// entries and ignored `?page=N`, so it couldn't cover users who skipped many
// versions. HTML structure is less stable than an API contract; expect to
// revisit the regex anchors below if GitHub redesigns the releases page.
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

// Anchors we lock onto. Each release sits in a `<div ... class="Box">`
// wrapper that contains: an `<a>` to `/releases/tag/<TAG>`, a
// `<relative-time datetime="...">`, and a `<div data-test-selector=
// "body-content" class="markdown-body ...">` holding the release notes.
const BODY_OPEN_RE = /<div\b[^>]*data-test-selector="body-content"[^>]*>/g;
const TAG_LINK_RE = /<a\b[^>]*href="\/[^"]+\/releases\/tag\/([^"?#]+)"/g;
const DATE_RE = /<relative-time\b[^>]*datetime="([^"]+)"/g;
const VERSION_HEAD_RE =
  /^(v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)(?:\s*[—–-]\s*(.*))?$/;
const H1_BLOCK_RE = /^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/;
const STRIP_TAGS_RE = /<[^>]+>/g;
const DIV_TAG_RE = /<\/?div\b[^>]*>/g;

// Find the position of the matching `</div>` for an open `<div>` whose
// content begins at `contentStart`. Counts opens/closes to handle nested
// `<div>`s — GitHub renders markdown content as `<p>`, `<h2>`, `<ul>` etc.
// (no divs), but a malformed release body could still contain one.
function findMatchingDivClose(html: string, contentStart: number): number {
  DIV_TAG_RE.lastIndex = contentStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = DIV_TAG_RE.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return m.index;
    } else {
      depth++;
    }
  }
  return -1;
}

// Track previous matches of `re` and return the latest one whose index is
// strictly before `pos`. Used to find the tag link / date that belongs to
// each release (always rendered above its body-content div).
function findClosestBefore(
  html: string,
  pos: number,
  re: RegExp,
): RegExpExecArray | null {
  re.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index >= pos) break;
    last = m;
  }
  return last;
}

function parseReleasesHtml(html: string): ParsedRelease[] {
  const results: ParsedRelease[] = [];
  const seen = new Set<string>();

  BODY_OPEN_RE.lastIndex = 0;
  let bodyMatch: RegExpExecArray | null;
  while ((bodyMatch = BODY_OPEN_RE.exec(html)) !== null) {
    const openEnd = bodyMatch.index + bodyMatch[0].length;
    const closeIndex = findMatchingDivClose(html, openEnd);
    if (closeIndex < 0) continue;

    // Tag — prefer the explicit anchor link above the body since the page
    // header is canonical. Falls back to parsing the body's <h1> heading.
    const linkMatch = findClosestBefore(html, bodyMatch.index, TAG_LINK_RE);
    let tag: string | null = linkMatch
      ? decodeURIComponent(linkMatch[1])
      : null;

    let rawBody = html.slice(openEnd, closeIndex);
    let name: string | null = null;

    const h1Match = H1_BLOCK_RE.exec(rawBody);
    if (h1Match) {
      const titleText = h1Match[1].replace(STRIP_TAGS_RE, '').trim();
      const titleParts = VERSION_HEAD_RE.exec(titleText);
      if (titleParts) {
        if (!tag) tag = titleParts[1];
        name = titleParts[2]?.trim() || null;
      } else if (!name) {
        name = titleText || null;
      }
      // Strip the h1 so the rendered body doesn't repeat the version heading.
      rawBody = rawBody.slice(h1Match[0].length);
    }

    if (!tag || seen.has(tag)) continue;
    seen.add(tag);

    const version = tag.replace(/^v/, '');
    const dateMatch = findClosestBefore(html, bodyMatch.index, DATE_RE);
    const publishedAt = dateMatch ? dateMatch[1] : null;
    const body = rawBody.trim();

    results.push({
      tag,
      version,
      name,
      body: body.length > 0 ? body : null,
      htmlUrl: `${RELEASE_TAG_URL_PREFIX}${encodeURIComponent(tag)}`,
      publishedAt,
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
