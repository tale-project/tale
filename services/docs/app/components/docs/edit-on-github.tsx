import { ExternalLink } from '@tale/webui/layout/external-link';
import { GitPullRequestArrow } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface EditOnGithubProps {
  /** Locale-prefixed content path, e.g. `en/platform/agents/concepts.mdx`. */
  contentPath: string;
}

const REPO_BASE =
  'https://github.com/tale-project/tale/edit/main/services/docs/app/content/';

export function EditOnGithub({ contentPath }: EditOnGithubProps) {
  const { t } = useT('docs');
  return (
    <ExternalLink
      href={`${REPO_BASE}${contentPath}`}
      className="text-fg-muted hover:text-fg-base text-xs transition-colors"
      showIcon={false}
    >
      <GitPullRequestArrow aria-hidden className="size-3" />
      <span>{t('editOnGithub')}</span>
    </ExternalLink>
  );
}
