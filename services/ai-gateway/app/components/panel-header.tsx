import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { GithubIcon } from '@tale/ui/icons/github';
import { LanguageSwitcher } from '@tale/ui/language-switcher';
import { TaleLogo } from '@tale/ui/logo';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { useT } from '@/lib/i18n/client';

/** Where the GitHub button leads. */
const REPOSITORY_URL = 'https://github.com/tale-project/tale';

/**
 * The panel's title strip — the documentation frame's header row, reused
 * measure for measure: one `h-13` box whose own border is the line under it
 * (`border-box`, never a bordered wrapper around a fixed-height row), a
 * blurred background, and the same `px-4 lg:px-6` gutter. The left is the
 * Tale mark and this service's name; the right is the docs footer's cluster
 * — language, theme, repository — in that order.
 *
 * Deliberately not the platform's `AdaptiveHeader`: that machinery portals a
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
    <header className="border-border bg-background/95 z-20 flex h-13 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-md lg:px-6">
      {/* The mark is decorative — the name beside it already says whose
          panel this is — and it steps aside on a phone so the title and the
          three controls both fit. */}
      <TaleLogo
        aria-hidden
        className="text-foreground hidden h-5 w-auto shrink-0 sm:block"
      />
      <span
        aria-hidden
        className="text-muted-foreground hidden shrink-0 sm:inline"
      >
        /
      </span>
      {/* `title`: the name is longer than a phone's share of this row, and a
          truncated heading should still be readable somewhere. */}
      <h1
        className="text-foreground min-w-0 truncate text-sm font-medium"
        title={t('title')}
      >
        {t('title')}
      </h1>
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
