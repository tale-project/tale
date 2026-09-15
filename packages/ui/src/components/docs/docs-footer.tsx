import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { GithubIcon } from '@tale/ui/icons/github';
import { LanguageSwitcher } from '@tale/ui/language-switcher';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

export interface DocsFooterProps {
  /** The site's legal lines (copyright, licence), one paragraph each. */
  legalLines: readonly string[];
  /** Deploy base the machine-readable indexes live under (`/` at the root). */
  baseUrl: string;
  /** The repository the GitHub button opens. */
  repositoryUrl: string;
  /** Offer the language switcher. Off for a site whose pages ship in one
   *  language — its links would lead nowhere. */
  showLanguageSwitcher?: boolean;
}

/**
 * The docs footer — one compact row closing the article column: the legal
 * lines on the left, the machine-readable indexes plus the language/theme
 * switchers and the repository link on the right. Navigation is the rail's
 * job, so nothing is repeated here.
 */
export function DocsFooter({
  legalLines,
  baseUrl,
  repositoryUrl,
  showLanguageSwitcher = false,
}: DocsFooterProps) {
  const { t } = useT('docs');
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return (
    <footer
      // `pr-16` keeps a lane clear on the right for the floating back-to-top
      // control (`fixed right-6 bottom-6`), which otherwise covers the last
      // button in the row once the reader reaches the end of a long page.
      className="border-border mt-auto border-t px-4 py-4 pr-16 lg:px-6 lg:pr-16 print:hidden"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground min-w-0 text-xs leading-relaxed">
          {legalLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}llms.txt`}>{t('footer.llmsTxt')}</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`${base}llms-full.txt`}>{t('footer.llmsFullTxt')}</a>
          </Button>
          {showLanguageSwitcher ? <LanguageSwitcher /> : null}
          <ThemeSwitcher />
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={t('footer.github')}
          >
            <a
              href={repositoryUrl}
              aria-label={t('footer.github')}
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
