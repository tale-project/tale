import { Card } from '@tale/ui/card';
import { useT } from '@tale/ui/i18n/client';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import type { DocsNavPage } from './docs-nav';

export interface DocsPrevNextProps {
  /** The page before this one in navigation order. */
  prev?: DocsNavPage | null;
  /** The page after this one in navigation order. */
  next?: DocsNavPage | null;
}

/**
 * Previous / next neighbours in flattened nav order, as the one bordered
 * surface the app has: an interactive `Card` wrapping the router link.
 */
export function DocsPrevNext({ prev, next }: DocsPrevNextProps) {
  const { t } = useT('docs');
  if (!prev && !next) return null;

  return (
    <nav
      aria-label={t('pagination')}
      className="border-border mt-12 grid gap-3 border-t pt-8 sm:grid-cols-2 print:hidden"
    >
      {prev ? (
        <Card asChild padding="md" interactive>
          <Link
            to={prev.href}
            // Exact: the page before a locale's first page is its home
            // (`/de`), which prefixes this page's route — an active router
            // link would claim `aria-current="page"`.
            activeOptions={{ exact: true }}
            // Named with its direction: "Input" alone does not tell a
            // screen-reader user whether the card goes back or forward.
            aria-label={`${t('previous')}: ${prev.label}`}
            className="flex min-w-0 flex-col gap-1"
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              <ArrowLeft aria-hidden className="size-3" />
              {t('previous')}
            </span>
            <span className="text-foreground truncate text-sm font-medium">
              {prev.label}
            </span>
          </Link>
        </Card>
      ) : null}
      {next ? (
        <Card asChild padding="md" interactive className="sm:col-start-2">
          <Link
            to={next.href}
            activeOptions={{ exact: true }}
            aria-label={`${t('next')}: ${next.label}`}
            className="flex min-w-0 flex-col items-end gap-1 text-right"
          >
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
              {t('next')}
              <ArrowRight aria-hidden className="size-3" />
            </span>
            <span className="text-foreground max-w-full truncate text-sm font-medium">
              {next.label}
            </span>
          </Link>
        </Card>
      ) : null}
    </nav>
  );
}
