'use node';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';

// Atom feed instead of api.github.com to avoid the 60-req/hour unauthenticated
// rate limit. Atom is CDN-served, stable (RFC 4287), and capped to the 10 most
// recent releases — enough for "see what changed since you last upgraded".
// Older history stays one click away via the GitHub releases link.
const ATOM_FEED_URL = 'https://github.com/tale-project/tale/releases.atom';

const releaseShape = v.object({
  tag: v.string(),
  version: v.string(),
  name: v.union(v.string(), v.null()),
  body: v.union(v.string(), v.null()),
  htmlUrl: v.string(),
  publishedAt: v.union(v.string(), v.null()),
});

const ENTITY_MAP: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (full, code: string) => {
      if (code in ENTITY_MAP) return ENTITY_MAP[code];
      if (code.startsWith('#x')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(Number(code.slice(1)));
      }
      return full;
    },
  );
}

function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(block);
  return m ? m[1] : null;
}

function pickAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`);
  const m = re.exec(block);
  return m ? m[1] : null;
}

interface ParsedRelease {
  tag: string;
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string;
  publishedAt: string | null;
}

function parseEntry(block: string): ParsedRelease | null {
  const linkHref = pickAttr(block, 'link', 'href');
  if (!linkHref) return null;
  // The release-page link looks like .../releases/tag/v0.26.0
  // Anything else (self-link, branch links) we skip.
  const tagMatch = linkHref.match(/\/releases\/tag\/([^/?#]+)/);
  if (!tagMatch) return null;
  const tag = decodeURIComponent(tagMatch[1]);
  const version = tag.replace(/^v/, '');

  const title = pickTag(block, 'title');
  const updated = pickTag(block, 'updated');
  const contentRaw = pickTag(block, 'content');

  return {
    tag,
    version,
    name: title ? decodeEntities(title).trim() : null,
    body: contentRaw ? decodeEntities(contentRaw).trim() : null,
    htmlUrl: linkHref,
    publishedAt: updated,
  };
}

export const fetchReleasesUncached = internalAction({
  args: {},
  returns: v.array(releaseShape),
  handler: async () => {
    const response = await fetch(ATOM_FEED_URL, {
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml',
        'User-Agent': 'tale-platform',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(
        `GitHub releases atom fetch failed: ${response.status} ${errorText}`,
      );
      throw new Error(`GitHub releases atom fetch failed: ${response.status}`);
    }

    const xml = await response.text();
    const releases: ParsedRelease[] = [];
    const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(xml)) !== null) {
      const release = parseEntry(match[1]);
      if (release) releases.push(release);
    }
    return releases;
  },
});
