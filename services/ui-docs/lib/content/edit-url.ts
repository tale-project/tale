import { contentFilePath } from '@/lib/content/paths';
import { TALE_REPO_URL } from '@/lib/site-url';

// The repository and branch a build's "Edit on GitHub" links point at, so a
// preview deployment can link back to its own branch (or a fork).
const BRANCH = import.meta.env.VITE_UI_DOCS_BRANCH ?? 'main';
const REPO_URL = import.meta.env.VITE_UI_DOCS_REPO_URL ?? TALE_REPO_URL;

/** GitHub editor URL of the markdown file behind a slug. */
export function docEditUrl(slug: string): string {
  return `${REPO_URL.replace(/\/$/, '')}/edit/${BRANCH}/${contentFilePath(slug)}`;
}
