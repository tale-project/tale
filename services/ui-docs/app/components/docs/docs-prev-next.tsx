import { Card } from '@tale/ui/card';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { getDocPage } from '@/lib/content/loader';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';

interface DocsPrevNextProps {
  prevSlug: string | null;
  nextSlug: string | null;
}

function NeighbourCard({
  slug,
  direction,
  label,
}: {
  slug: string;
  direction: 'prev' | 'next';
  label: string;
}) {
  const doc = getDocPage(slug);
  const isNext = direction === 'next';
  return (
    <Card asChild padding="md" interactive className="min-w-0 flex-1">
      <Link
        to={docPath(slug)}
        className={isNext ? 'text-right' : undefined}
        aria-label={`${label}: ${doc?.frontmatter.title ?? slug}`}
      >
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {isNext ? null : <ArrowLeft aria-hidden className="size-3.5" />}
          <span className={isNext ? 'ml-auto' : undefined}>{label}</span>
          {isNext ? <ArrowRight aria-hidden className="size-3.5" /> : null}
        </span>
        <span className="text-foreground mt-1 block truncate text-sm font-medium">
          {doc?.frontmatter.title ?? slug}
        </span>
      </Link>
    </Card>
  );
}

/**
 * The two neighbours in nav order, as the one bordered surface the system
 * has. Reading order is the navigation's order, so a reader who just finishes
 * a page always has the next one in reach.
 */
export function DocsPrevNext({ prevSlug, nextSlug }: DocsPrevNextProps) {
  const { t } = useT('docs');
  if (!prevSlug && !nextSlug) return null;

  return (
    <nav
      aria-label={t('pagination')}
      className="mt-12 flex flex-col gap-3 sm:flex-row"
    >
      {prevSlug ? (
        <NeighbourCard slug={prevSlug} direction="prev" label={t('previous')} />
      ) : (
        <div className="flex-1" />
      )}
      {nextSlug ? (
        <NeighbourCard slug={nextSlug} direction="next" label={t('next')} />
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
