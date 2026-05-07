import { ExternalLink } from '@tale/webui/layout/external-link';
import { GitPullRequestArrow } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface EditOnGithubProps {
  /** Locale-prefixed content path, e.g. `en/platform/agents/concepts.mdx`. */
  contentPath: string;
}

const DEFAULT_REPO_URL = 'https://github.com/tale-project/tale';
const DEFAULT_BRANCH = 'main';
const CONTENT_PATH_PREFIX = 'services/docs/app/content/';

// Resolve the repo URL and branch from Vite-exposed env vars so operators can
// deploy preview/staging docs that link back to the right branch (or a fork).
const REPO_URL = import.meta.env.VITE_DOCS_REPO_URL ?? DEFAULT_REPO_URL;
const BRANCH = import.meta.env.VITE_DOCS_BRANCH ?? DEFAULT_BRANCH;
const REPO_BASE = `${REPO_URL.replace(/\/$/, '')}/edit/${BRANCH}/${CONTENT_PATH_PREFIX}`;

export function EditOnGithub({ contentPath }: EditOnGithubProps) {
  const { t } = useT('docs');
  // Source files on disk are `.md` (not `.mdx`). Normalise any extension the
  // caller passes so the GitHub edit URL points at the real file.
  const normalisedPath = contentPath.replace(/\.mdx?$/, '') + '.md';
  const label = t('editOnGithub');
  return (
    <ExternalLink
      href={`${REPO_BASE}${normalisedPath}`}
      className="text-fg-muted hover:text-fg-base text-xs transition-colors"
      showIcon={false}
      aria-label={label}
    >
      <GitPullRequestArrow aria-hidden className="size-3" />
      <span>{label}</span>
    </ExternalLink>
  );
}
