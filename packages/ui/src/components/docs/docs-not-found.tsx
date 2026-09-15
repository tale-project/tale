import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Heading } from '@tale/ui/heading';
import { useT } from '@tale/ui/i18n/client';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';

import { DocsHeader } from './docs-header';
import type { DocsNavPage } from './docs-nav';

export interface DocsNotFoundProps {
  /** The documentation's front door: the trail's first crumb and the
   *  destination of the way back. */
  home: DocsNavPage;
  /** Pages close to the one the reader asked for, closest first. */
  suggestions: readonly DocsNavPage[];
}

/**
 * The documentation 404, inside the docs chrome: the header strip names the
 * page, then a heading that says what happened, the closest pages as cards
 * and one route back to the front door. Most ways to land here are a stale
 * link, so the suggestions usually hold the page the reader wanted.
 */
export function DocsNotFound({ home, suggestions }: DocsNotFoundProps) {
  const { t } = useT('docs');

  return (
    <>
      <DocsHeader crumbs={[home, { label: t('notFound.title') }]} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 px-4 py-8 lg:px-6">
        <div className="w-full max-w-3xl min-w-0 flex-1">
          <Heading level={1} tracking="tight" className="text-3xl md:text-4xl">
            {t('notFound.title')}
          </Heading>
          <Text variant="muted" className="mt-3 text-base leading-relaxed">
            {t('notFound.body')}
          </Text>

          {suggestions.length > 0 ? (
            <nav aria-label={t('notFound.suggestions')} className="mt-8">
              <Text variant="label" className="mb-2">
                {t('notFound.suggestions')}
              </Text>
              <ul className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((page) => (
                  <li key={page.href}>
                    <Card asChild padding="md" interactive>
                      <Link
                        to={page.href}
                        activeOptions={{ exact: true }}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <FileText
                          aria-hidden
                          className="text-muted-foreground size-4 shrink-0"
                        />
                        <span className="text-foreground truncate text-sm font-medium">
                          {page.label}
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <div className="mt-8">
            <Button asChild variant="secondary">
              {/* Exact: a locale home prefixes the missing URL, and an
                  active router link claims `aria-current="page"`. */}
              <Link to={home.href} activeOptions={{ exact: true }}>
                {t('notFound.backHome')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
