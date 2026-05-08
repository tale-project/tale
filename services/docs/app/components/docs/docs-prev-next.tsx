import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { getDocPage } from '@/lib/content/loader';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsPrevNextProps {
  locale: SupportedLocale;
  prevSlug: string | null;
  nextSlug: string | null;
}

/** Title-case the last slug segment (e.g. `self-hosted/install/quickstart` → `Quickstart`). */
function prettifySlug(slug: string): string {
  const segments = slug.split('/');
  const last = segments.findLast((segment) => segment.length > 0) ?? slug;
  return last
    .split('-')
    .map((part) =>
      part.length === 0 ? part : part[0].toUpperCase() + part.slice(1),
    )
    .join(' ');
}

function pageLabel(locale: SupportedLocale, slug: string): string {
  const doc = getDocPage(locale, slug);
  const title = doc?.frontmatter.title;
  if (title && title.length > 0) return title;
  return prettifySlug(slug);
}

export function DocsPrevNext({
  locale,
  prevSlug,
  nextSlug,
}: DocsPrevNextProps) {
  // `useT('docs')` is safe even though `previous`/`next` keys aren't (yet) in
  // the message bundles — i18next falls back to the key name, which renders as
  // `previous`/`next` in dev. Once the keys are added in en/de/fr the labels
  // localize automatically without further code changes.
  const { t } = useT('docs');
  if (!prevSlug && !nextSlug) return null;
  return (
    <nav className="border-border-base mt-12 flex flex-col items-stretch gap-3 border-t pt-6 sm:flex-row">
      {prevSlug ? (
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, prevSlug) as any}
          className="border-border-base bg-bg-base hover:border-border-strong hover:bg-bg-elevated group flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-4 py-3 transition-colors"
        >
          <span className="text-fg-muted inline-flex items-center gap-1.5 text-xs">
            <ArrowLeft aria-hidden className="size-3" />
            {t('previous')}
          </span>
          <span className="text-fg-base truncate text-sm font-medium">
            {pageLabel(locale, prevSlug)}
          </span>
        </Link>
      ) : (
        <div aria-hidden className="hidden flex-1 sm:block" />
      )}
      {nextSlug ? (
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, nextSlug) as any}
          className="border-border-base bg-bg-base hover:border-border-strong hover:bg-bg-elevated group flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-4 py-3 text-right transition-colors"
        >
          <span className="text-fg-muted inline-flex items-center justify-end gap-1.5 text-xs">
            {t('next')}
            <ArrowRight aria-hidden className="size-3" />
          </span>
          <span className="text-fg-base truncate text-sm font-medium">
            {pageLabel(locale, nextSlug)}
          </span>
        </Link>
      ) : (
        <div aria-hidden className="hidden flex-1 sm:block" />
      )}
    </nav>
  );
}
