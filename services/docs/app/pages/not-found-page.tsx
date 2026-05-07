import { Button } from '@tale/ui/button';
import { Link, useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import { flattenNav } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

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
function slugLabel(slug: string): string {
  if (slug === 'index') return 'Home';
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

  return (
    <div className="flex flex-col items-start gap-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-fg-base text-3xl font-semibold">
          {t('notFoundTitle')}
        </h1>
        <p className="text-fg-muted">{t('notFoundBody')}</p>
      </div>

      {suggestions.length > 0 && (
        <nav
          aria-label={t('notFoundSuggestions')}
          className="flex flex-col gap-2"
        >
          <p className="text-fg-base text-sm font-medium">
            {t('notFoundSuggestions')}
          </p>
          <ul className="flex flex-col gap-1">
            {suggestions.map((slug) => (
              <li key={slug}>
                <Link
                  // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
                  to={docPath(locale, slug) as any}
                  className="text-fg-link hover:text-fg-link-hover text-sm underline-offset-4 hover:underline"
                >
                  {slugLabel(slug)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <Button asChild variant="secondary">
        <Link
          // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
          to={docPath(locale, 'index') as any}
        >
          {t('notFoundBackHome')}
        </Link>
      </Button>
    </div>
  );
}
