import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { TaleLogo } from '@tale/ui/logo';
import {
  LanguageSwitcher,
  stripLocalePrefix,
} from '@tale/webui/layout/language-switcher';
import { ThemeSwitcher } from '@tale/webui/layout/theme-switcher';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { GithubIcon } from '@/app/components/icons/github-icon';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsHeaderProps {
  locale: SupportedLocale;
  /** Open the search dialog. */
  onOpenSearch: () => void;
}

/**
 * Build the docs URL for `target` based on the current pathname. Docs
 * routing is splat-only: locale prefix sits as the first URL segment
 * (`/de/...`) for non-English, and English lives at the canonical path.
 */
function resolveDocsLocaleUrl(
  target: SupportedLocale,
  pathname: string,
): string {
  const canonical = stripLocalePrefix(pathname);
  if (target === 'en') return canonical;
  return canonical === '/' ? `/${target}` : `/${target}${canonical}`;
}

export function DocsHeader({ locale, onOpenSearch }: DocsHeaderProps) {
  const { t } = useT('nav');
  const [scrolled, setScrolled] = useState(false);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    // Detect macOS to choose between ⌘K and Ctrl+K hint. Use the modern
    // userAgentData when available, falling back to navigator.platform.
    const platform =
      // oxlint-disable-next-line typescript/no-explicit-any -- userAgentData is not yet in lib.dom
      (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors',
        scrolled
          ? 'border-border-base bg-bg-base/85 supports-[backdrop-filter]:bg-bg-base/65 border-b backdrop-blur'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-4 px-5 md:px-8">
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, 'index') as any}
          aria-label={t('homeAriaLabel')}
          className="text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
        <span className="text-fg-muted hidden text-sm font-medium md:inline">
          {t('docs')}
        </span>

        <div className="flex flex-1 items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={t('openSearch')}
            className="border-border-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Search aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">{t('searchPlaceholder')}</span>
            <kbd className="border-border-base hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
          <LanguageSwitcher resolveLocaleUrl={resolveDocsLocaleUrl} />
          <ThemeSwitcher />
          <IconButton
            asChild
            icon={GithubIcon}
            iconSize={4}
            variant="secondary"
            aria-label={t('githubAriaLabel')}
            className="size-9"
            slotChild={
              // The IconButton injects the GitHub mark as the slot child's
              // content at runtime (Radix Slot semantics), so the empty <a>
              // here is intentional. The aria-label on the IconButton
              // propagates to the rendered anchor.
              // oxlint-disable-next-line jsx-a11y/anchor-has-content
              <a
                href="https://github.com/tale-project/tale"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          />
          <Button asChild size="sm">
            <a
              href="https://tale.dev/request-demo"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('requestDemo')}
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
