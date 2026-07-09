import { GithubIcon } from '@tale/ui/icons/github';
import { TALE_GITHUB_URL } from '@tale/ui/seo/globals';
import { SiteFooter } from '@tale/ui/site-footer';

import { useT } from '@/lib/i18n/client';

/**
 * Docs footer — slimmed down to the bottom-bar variant of the shared
 * `SiteFooter`: copyright, language + theme switchers, GitHub link, and
 * the `llms.txt` shortcut. The marketing site keeps the full columned
 * layout; docs readers don't need product/legal links repeated below
 * every page since the sidebar already covers navigation.
 */
export function DocsFooter() {
  const { t } = useT('footer');

  return (
    <SiteFooter
      containerClassName="max-w-[1400px] px-4 sm:px-5 md:px-8"
      copyrightLines={[
        t('copyrightLine1', { year: new Date().getFullYear() }),
        t('copyrightLine2'),
      ]}
      llmsTxtUrl={`${import.meta.env.BASE_URL}llms.txt`}
      llmsTxtLabel={t('llmsTxtLabel')}
      llmsFullTxtUrl={`${import.meta.env.BASE_URL}llms-full.txt`}
      llmsFullTxtLabel={t('llmsFullTxtLabel')}
      bottomTrailing={
        <a
          href={TALE_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('githubAriaLabel')}
          className="text-fg-muted hover:bg-bg-muted hover:text-fg-base inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <GithubIcon className="h-5 w-5" />
        </a>
      }
    />
  );
}
