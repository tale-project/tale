const DEFAULT_REPO_URL = 'https://github.com/tale-project/tale';
const DEFAULT_BRANCH = 'main';
const CONTENT_PATH_PREFIX = 'docs/';

// Resolve the repo URL and branch from Vite-exposed env vars so operators can
// deploy preview/staging docs that link back to the right branch (or a fork).
const REPO_URL = import.meta.env.VITE_DOCS_REPO_URL ?? DEFAULT_REPO_URL;
const BRANCH = import.meta.env.VITE_DOCS_BRANCH ?? DEFAULT_BRANCH;
const REPO_BASE = `${REPO_URL.replace(/\/$/, '')}/edit/${BRANCH}/${CONTENT_PATH_PREFIX}`;

/**
 * GitHub editor URL for a page's source, from its locale-prefixed content
 * path (`en/platform/agents/concepts`).
 */
export function docEditUrl(contentPath: string): string {
  // Source files on disk are `.md` (not `.mdx`). Normalise any extension the
  // caller passes so the GitHub edit URL points at the real file.
  return `${REPO_BASE}${contentPath.replace(/\.mdx?$/, '')}.md`;
}
