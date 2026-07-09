import type { Release } from '@/lib/releases/types';

interface GithubReleaseJson {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

const VERSION_HEAD_RE =
  /^(v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)(?:\s*[—–-]\s*(.*))?$/;

/**
 * Map a GitHub Releases API payload into the shared `Release` shape.
 * Skips drafts; keeps prereleases (operators may still want them).
 */
export function mapGithubApiRelease(raw: GithubReleaseJson): Release | null {
  if (raw.draft) return null;
  const tag = raw.tag_name?.trim();
  if (!tag) return null;
  const version = tag.replace(/^v/, '');

  let name: string | null = null;
  const title = raw.name?.trim() || null;
  if (title) {
    // "Tale v0.3.3 — Foo" / "v0.3.3 — Foo" / bare "Tale v0.3.3"
    const stripped = title.replace(/^Tale\s+/i, '').trim();
    const parts = VERSION_HEAD_RE.exec(stripped);
    if (parts?.[2]?.trim()) {
      name = parts[2].trim();
    } else if (stripped !== tag && stripped !== version) {
      name = stripped;
    }
  }

  const body = raw.body?.trim() || null;

  return {
    tag,
    version,
    name,
    body,
    htmlUrl:
      raw.html_url?.trim() ||
      `https://github.com/tale-project/tale/releases/tag/${encodeURIComponent(tag)}`,
    publishedAt: raw.published_at ?? null,
  };
}

export function mapGithubApiReleases(
  payload: readonly GithubReleaseJson[],
): Release[] {
  const out: Release[] = [];
  const seen = new Set<string>();
  for (const raw of payload) {
    const release = mapGithubApiRelease(raw);
    if (!release || seen.has(release.tag)) continue;
    seen.add(release.tag);
    out.push(release);
  }
  return out;
}
