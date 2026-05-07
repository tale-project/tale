import { Link } from '@tanstack/react-router';
import { ChevronRight, Home } from 'lucide-react';

import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface Crumb {
  label: string;
  slug?: string;
}

interface DocsBreadcrumbsProps {
  locale: SupportedLocale;
  crumbs: Crumb[];
}

export function DocsBreadcrumbs({ locale, crumbs }: DocsBreadcrumbsProps) {
  const { t } = useT('docs');
  // Locale landing pages (slug === 'index') return zero crumbs from
  // `buildBreadcrumbs` — there's no useful trail to show, so render nothing.
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label={t('breadcrumbs')}
      className="text-fg-muted mb-4 flex flex-wrap items-center gap-1 text-xs"
    >
      <Link
        // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
        to={docPath(locale, 'index') as any}
        className="hover:text-fg-base inline-flex items-center gap-1 transition-colors"
      >
        <Home aria-hidden className="size-3" />
        <span className="sr-only">{t('home')}</span>
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="flex items-center gap-1">
          <ChevronRight aria-hidden className="size-3 opacity-60" />
          {crumb.slug ? (
            <Link
              // oxlint-disable-next-line typescript/no-explicit-any
              to={docPath(locale, crumb.slug) as any}
              className="hover:text-fg-base transition-colors"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-fg-base">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
