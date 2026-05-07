import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { getDocPage } from '@/lib/content/loader';
import { docPath } from '@/lib/content/paths';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsPrevNextProps {
  locale: SupportedLocale;
  prevSlug: string | null;
  nextSlug: string | null;
}

function pageLabel(locale: SupportedLocale, slug: string): string {
  const doc = getDocPage(locale, slug);
  return doc?.frontmatter.title ?? slug;
}

export function DocsPrevNext({
  locale,
  prevSlug,
  nextSlug,
}: DocsPrevNextProps) {
  if (!prevSlug && !nextSlug) return null;
  return (
    <nav className="border-border-base mt-12 flex items-stretch gap-3 border-t pt-6">
      {prevSlug ? (
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, prevSlug) as any}
          className="border-border-base bg-bg-base hover:border-border-strong group flex flex-1 flex-col gap-1 rounded-lg border px-4 py-3 transition-colors"
        >
          <span className="text-fg-muted inline-flex items-center gap-1.5 text-xs">
            <ArrowLeft aria-hidden className="size-3" />
            Previous
          </span>
          <span className="text-fg-base text-sm font-medium">
            {pageLabel(locale, prevSlug)}
          </span>
        </Link>
      ) : null}
      {nextSlug ? (
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any
          to={docPath(locale, nextSlug) as any}
          className="border-border-base bg-bg-base hover:border-border-strong group flex flex-1 flex-col gap-1 rounded-lg border px-4 py-3 text-right transition-colors"
        >
          <span className="text-fg-muted inline-flex items-center justify-end gap-1.5 text-xs">
            Next
            <ArrowRight aria-hidden className="size-3" />
          </span>
          <span className="text-fg-base text-sm font-medium">
            {pageLabel(locale, nextSlug)}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
