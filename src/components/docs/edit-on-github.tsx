import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { GitPullRequestArrow } from 'lucide-react';

export interface EditOnGithubProps {
  /** GitHub editor URL of the markdown file behind the page. */
  href: string;
}

/**
 * The "fix this page" affordance. Deep-links straight into GitHub's editor
 * for the page's source file, so a reader who spots a mistake is two clicks
 * from a pull request. The site builds the URL — only it knows where its
 * content lives and which branch a build should point at.
 */
export function EditOnGithub({ href }: EditOnGithubProps) {
  const { t } = useT('docs');

  return (
    <Button asChild variant="ghost" size="sm" icon={GitPullRequestArrow}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {t('editOnGithub')}
      </a>
    </Button>
  );
}
