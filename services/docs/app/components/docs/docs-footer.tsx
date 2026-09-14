import { Button } from '@tale/ui/button';
import { GithubIcon } from '@tale/ui/icons/github';
import { LanguageSwitcher } from '@tale/ui/language-switcher';
import { TALE_GITHUB_URL } from '@tale/ui/seo/globals';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { useT } from '@/lib/i18n/client';

/**
 * The docs footer — one compact row closing the article column: the legal
 * lines on the left, the machine-readable indexes plus the language/theme
 * switchers and the repository link on the right. Navigation is the rail's
 * job, so nothing is repeated here.
 */
export function DocsFooter() {
  const { t } = useT('footer');
  const base = import.meta.env.BASE_URL;
  const label = t('githubAriaLabel');

  return (
    <footer
      // `pr-16` keeps a lane clear on the right for the floating back-to-top
      // control (`fixed right-6 bottom-6`), which otherwise covers the last
      // button in the row once the reader reaches the end of a long page.
      className="border-border mt-auto border-t px-4 py-4 pr-16 lg:px-6 lg:pr-16 print:hidden"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground min-w-0 text-xs leading-relaxed">
          <p>{t('copyrightLine1', { year: new Date().getFullYear() })}</p>
          <p>{t('copyrightLine2')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}llms.txt`}>{t('llmsTxtLabel')}</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}llms-full.txt`}>{t('llmsFullTxtLabel')}</a>
          </Button>
          <LanguageSwitcher />
          <ThemeSwitcher />
          <Button asChild variant="ghost" size="icon" aria-label={label}>
            <a
              href={TALE_GITHUB_URL}
              aria-label={label}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubIcon aria-hidden className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </footer>
  );
}
