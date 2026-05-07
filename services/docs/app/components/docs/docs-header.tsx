import { TaleLogo } from '@tale/ui/logo';
import { SiteHeader } from '@tale/webui/layout/site-header';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DocsNavList } from '@/app/components/docs/docs-sidebar';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsHeaderProps {
  locale: SupportedLocale;
  /** Slug of the active page; used to highlight the current item in the
   *  mobile drawer. */
  activeSlug: string;
  /** Open the search dialog. */
  onOpenSearch: () => void;
}

function SearchTrigger({
  isMac,
  label,
  placeholder,
  onClick,
}: {
  isMac: boolean;
  label: string;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="border-border-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <Search aria-hidden className="size-3.5" />
      <span className="hidden sm:inline">{placeholder}</span>
      <kbd className="border-border-base hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  );
}

export function DocsHeader({
  locale,
  activeSlug,
  onOpenSearch,
}: DocsHeaderProps) {
  const { t } = useT('nav');
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    // Detect macOS to choose between ⌘K and Ctrl+K hint. Use the modern
    // userAgentData when available, falling back to navigator.platform.
    const platform =
      // oxlint-disable-next-line typescript/no-explicit-any -- userAgentData is not yet in lib.dom
      (navigator as any).userAgentData?.platform ?? navigator.platform ?? '';
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

  return (
    <SiteHeader
      containerClassName="max-w-[1400px] px-4 sm:px-5 md:px-8"
      openMenuLabel={t('openMenu')}
      closeMenuLabel={t('closeMenu')}
      logo={
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, 'index') as any}
          aria-label={t('homeAriaLabel')}
          className="text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex items-center rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <TaleLogo />
        </Link>
      }
      desktopActions={
        <SearchTrigger
          isMac={isMac}
          label={t('openSearch')}
          placeholder={t('searchPlaceholder')}
          onClick={onOpenSearch}
        />
      }
      mobileNav={
        <div className="flex flex-col gap-2">
          <SearchTrigger
            isMac={isMac}
            label={t('openSearch')}
            placeholder={t('searchPlaceholder')}
            onClick={onOpenSearch}
          />
          <div className="-mx-3">
            <DocsNavList locale={locale} activeSlug={activeSlug} />
          </div>
        </div>
      }
    />
  );
}
