import { Card } from '@tale/ui/card';
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

/**
 * Previous / next neighbours in flattened nav order, as the one bordered
 * surface the app has: an interactive `Card` wrapping the router link.
 */
export function DocsPrevNext({
  locale,
  prevSlug,
  nextSlug,
}: DocsPrevNextProps) {
  const { t } = useT('docs');
  if (!prevSlug && !nextSlug) return null;

  return (
    <nav
      aria-label={t('pagination')}
      className="border-border mt-12 grid gap-3 border-t pt-8 sm:grid-cols-2"
    >
      {prevSlug ? (
        <Card asChild padding="md" interactive>
          <Link
            to={docPath(locale, prevSlug)}
            className="flex min-w-0 flex-col gap-1"
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <ArrowLeft aria-hidden className="size-3" />
              {t('previous')}
            </span>
            <span className="text-foreground truncate text-sm font-medium">
              {pageLabel(locale, prevSlug)}
            </span>
          </Link>
        </Card>
      ) : null}
      {nextSlug ? (
        <Card asChild padding="md" interactive className="sm:col-start-2">
          <Link
            to={docPath(locale, nextSlug)}
            className="flex min-w-0 flex-col items-end gap-1 text-right"
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              {t('next')}
              <ArrowRight aria-hidden className="size-3" />
            </span>
            <span className="text-foreground max-w-full truncate text-sm font-medium">
              {pageLabel(locale, nextSlug)}
            </span>
          </Link>
        </Card>
      ) : null}
    </nav>
  );
}
