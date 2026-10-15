import { AdaptiveHeaderTitle } from '@tale/ui/adaptive-header';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { GithubIcon } from '@tale/ui/icons/github';
import { LanguageSwitcher } from '@tale/ui/language-switcher';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { useT } from '@/lib/i18n/client';

/** Where the GitHub button leads. */
const REPOSITORY_URL = 'https://github.com/tale-project/tale';

/**
 * The panel's title strip — the platform's own page header, measure for
 * measure: one `h-13` box whose own border is the line under it (`border-box`,
 * never a bordered wrapper around a fixed-height row), the blurred
 * `bg-background/80` the platform's sticky header sits on, and the same `px-4`
 * gutter the page below keeps, so the title and the table start on one edge.
 * The title is the platform's too — `AdaptiveHeaderTitle`, the very component
 * "Automations" and "Knowledge" are set in — so the service's name reads in
 * the weight and size every page title does. The right is the documentation
 * footer's cluster — language, theme, repository — in that order.
 *
 * Deliberately not the platform's `AdaptiveHeader` machinery: that portals a
 * page's chrome into a shared shell across breakpoints, and this service is
 * one screen with no shell. The language picker runs in `LanguageSwitcher`'s
 * state-driven mode — this panel is served as one untranslated tree, so it
 * carries no locale in its paths and the choice is a preference rather than
 * a destination.
 */
export function PanelHeader() {
  const { t } = useT('panel');
  const { locale, setLocale } = useLocale();

  return (
    <header className="border-border bg-background/80 z-20 flex h-13 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-md">
      {/* `min-w-0`: the title is the one thing in this row allowed to give way
          on a phone, so the three controls beside it always fit. */}
      <AdaptiveHeaderTitle className="min-w-0">
        {t('title')}
      </AdaptiveHeaderTitle>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <LanguageSwitcher onSelect={setLocale} value={locale} />
        <ThemeSwitcher />
        {/* The name rides both elements: `Button` types `size="icon"` as
            needing one, and Radix's `Slot` lets the anchor's own win. */}
        <Button aria-label={t('github')} asChild size="icon" variant="ghost">
          <a
            aria-label={t('github')}
            href={REPOSITORY_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon aria-hidden className="size-4" />
          </a>
        </Button>
      </div>
    </header>
  );
}
