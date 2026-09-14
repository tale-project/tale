import { Pencil } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { TALE_REPO_URL } from '@/lib/site-url';

interface EditOnGithubProps {
  /** Repository-relative path of the markdown file behind this page. */
  contentPath: string;
}

const BRANCH = import.meta.env.VITE_UI_DOCS_BRANCH ?? 'main';
const REPO_URL = import.meta.env.VITE_UI_DOCS_REPO_URL ?? TALE_REPO_URL;

/**
 * The "fix this page" affordance. Deep-links straight into GitHub's editor
 * for the exact markdown file, so a reader who spots a wrong prop name is two
 * clicks from a pull request.
 */
export function EditOnGithub({ contentPath }: EditOnGithubProps) {
  const { t } = useT('docs');
  const href = `${REPO_URL}/edit/${BRANCH}/${contentPath}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Pencil aria-hidden className="size-3.5" />
      {t('editOnGithub')}
    </a>
  );
}
