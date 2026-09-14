import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Text } from '@tale/ui/text';
import { Link, useRouterState } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';

import { DocsPageHeader } from '@/app/components/docs/docs-page-header';
import { flattenNav } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface NotFoundPageProps {
  locale: SupportedLocale;
}

/** Strip leading locale prefix + slashes so we compare slug-to-slug. */
function pathnameToSlug(pathname: string, locale: SupportedLocale): string {
  let p = pathname.replace(/^\/+|\/+$/g, '');
  if (locale !== 'en' && (p === locale || p.startsWith(`${locale}/`))) {
    p = p.slice(locale.length).replace(/^\/+/, '');
  }
  return p;
}

/** Iterative Levenshtein distance between two short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Score how similar `candidate` is to `query` (lower is closer). */
function score(query: string, candidate: string): number {
  if (candidate.includes(query) || query.includes(candidate)) return 0;
  // Compare last path segment first — usually most discriminating.
  const qLeaf = query.split('/').pop() ?? query;
  const cLeaf = candidate.split('/').pop() ?? candidate;
  const leafDist = levenshtein(qLeaf, cLeaf);
  const fullDist = levenshtein(query, candidate);
  return Math.min(leafDist, fullDist);
}

function pickSuggestions(query: string, max = 4): string[] {
  const all = flattenNav().map((p) => p.slug);
  if (!query) return all.slice(0, max);
  return all
    .map((slug) => ({ slug, s: score(query, slug) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, max)
    .map((x) => x.slug);
}

/** Human-friendly label from a slug, e.g. `platform/chat/basics` -> `Platform / Chat / Basics`. */
function slugLabel(slug: string, homeLabel: string): string {
  if (slug === 'index') return homeLabel;
  return slug
    .replace(/\/index$/, '')
    .split('/')
    .map((part) =>
      part
        .split('-')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' '),
    )
    .join(' / ');
}

export function NotFoundPage({ locale }: NotFoundPageProps) {
  const { t } = useT('docs');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const requestedSlug = pathnameToSlug(pathname, locale);
  const suggestions = useMemo(
    () => pickSuggestions(requestedSlug),
    [requestedSlug],
  );

  useDocumentMeta({
    title: t('notFoundTitle'),
    description: t('notFoundBody'),
    canonicalPath: '/404',
    locale,
    noindex: true,
  });

  return (
    <>
      <DocsPageHeader
        locale={locale}
        crumbs={[{ label: t('notFoundTitle') }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1 px-4 py-8 lg:px-6">
        <div className="w-full max-w-3xl min-w-0 flex-1">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
            {t('notFoundTitle')}
          </h1>
          <p className="text-muted-foreground mt-3 text-base leading-relaxed">
            {t('notFoundBody')}
          </p>

          {suggestions.length > 0 && (
            <nav aria-label={t('notFoundSuggestions')} className="mt-8">
              <Text variant="label" className="mb-2">
                {t('notFoundSuggestions')}
              </Text>
              <ul className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((slug) => (
                  <li key={slug}>
                    <Card asChild padding="md" interactive>
                      <Link
                        to={docPath(locale, slug)}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <FileText
                          aria-hidden
                          className="text-muted-foreground size-4 shrink-0"
                        />
                        <span className="text-foreground truncate text-sm font-medium">
                          {slugLabel(slug, t('home'))}
                        </span>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className="mt-8">
            <Button asChild variant="secondary">
              <Link to={docPath(locale, 'index')}>{t('notFoundBackHome')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
