/**
 * Shared route + body discovery for the marketing site. Used by both
 * the dev on-demand server (`artifacts-server.ts`) and the build-time
 * precompile CLI config (`scripts/seo.config.ts`) so the two modes
 * produce the same output.
 *
 * Sections:
 *
 *   - `MARKETING_ROUTES` — React-rendered pages (`/`, `/pricing`, …).
 *     Bodies need SSR; the dev path renders them via Vite's
 *     `ssrLoadModule`, the build-time path imports the prebuilt
 *     `dist-ssr/entry-server.js`.
 *   - `enumerateLegalRoutes()` — markdown files under
 *     `app/content/legal/{en,de,fr}/*.md`. Bodies are file contents with
 *     frontmatter stripped.
 */

import { readFile } from 'node:fs/promises';

import type {
  ArtifactRoute,
  ArtifactSection,
  OptionalPage,
} from '@tale/ui/seo';
import {
  buildLocaleAlternateUrls,
  htmlToMarkdown,
  withXDefault,
} from '@tale/ui/seo';
import {
  TALE_DOCS_LLMS_TXT,
  TALE_GITHUB_URL,
  TALE_SITE_URL,
} from '@tale/ui/seo/globals';
import { absoluteSitePath } from '@tale/ui/seo/urls';

import {
  enumerateLegalRoutes,
  LEGAL_CONTENT_ROOT,
  type LegalRoute,
} from '../../scripts/legal-routes';
import { localizedPath, SUPPORTED_LOCALES } from '../i18n/locales';
import { CHANGELOG_JSON_ROUTE } from '../releases/route';
import { marketingRoutesForLocale } from './marketing-routes';

/** URL-bearing marketing locales — must mirror scripts/prerender.ts. */
const MARKETING_LOCALES = SUPPORTED_LOCALES;

/** Full hreflang cluster (en/de/fr + x-default) for one marketing route. */
function marketingAlternates(url: string): Record<string, string> {
  return withXDefault(
    buildLocaleAlternateUrls(TALE_SITE_URL, MARKETING_LOCALES, (locale) =>
      localizedPath(locale as (typeof MARKETING_LOCALES)[number], url),
    ),
  );
}

export const WEB_SITE_TITLE = 'Tale';
export const WEB_SITE_DESCRIPTION =
  'Tale is the open-source workspace for teams and AI agents. Coordinate agents on project boards, assign tasks, and review the results together.';

/**
 * Product facts for `llms.txt` (Pages section intro). Keep factual and
 * aligned with visible homepage / pricing / security copy — no ratings.
 */
export const WEB_LLMS_PAGES_INTRO = [
  'Tale is the open-source workspace for teams and AI agents. Coordinate people and agents on project boards: assign tasks, follow progress, and review the results together. Give agents project instructions, files, and tools; use automations for repeatable workflows with configured approvals. Project agents can use runtimes including Claude Code and Codex; supported capabilities vary by runtime.',
  'Publisher: Ruler GmbH, Spiez, Switzerland. License: MIT. Community and Enterprise include the same product features; Enterprise adds professional operation and support. Current plans and terms: https://tale.dev/pricing.',
  'Self-host with Docker on your infrastructure or use managed Cloud. Choose local or cloud model providers. Data flows depend on the providers, connectors, and external tools you configure.',
  `Documentation: ${TALE_DOCS_LLMS_TXT} — source: ${TALE_GITHUB_URL}`,
].join('\n\n');

export interface SsrRenderer {
  render: (url: string) => Promise<{ html: string }>;
}

function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  return match ? match[1] : raw;
}

async function legalBody(route: LegalRoute): Promise<string> {
  const path = `${LEGAL_CONTENT_ROOT}/${route.locale}/${route.slug}.md`;
  return stripFrontmatter(await readFile(path, 'utf-8'));
}

export function buildWebSections(legal: LegalRoute[]): ArtifactSection[] {
  // Group legal entries by slug so we can attach hreflang alternates to
  // every locale variant of the same logical page.
  const alternatesBySlug = new Map<string, Record<string, string>>();
  for (const r of legal) {
    const alts = alternatesBySlug.get(r.slug) ?? {};
    alts[r.locale] = absoluteSitePath(TALE_SITE_URL, r.url);
    alternatesBySlug.set(r.slug, alts);
  }
  for (const [slug, alts] of alternatesBySlug) {
    alternatesBySlug.set(slug, withXDefault(alts));
  }

  const marketingRoutes: ArtifactRoute[] = marketingRoutesForLocale('en').map(
    (r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
      alternates: marketingAlternates(r.path),
    }),
  );

  // The prerendered /de and /fr variants belong in the sitemap (each with
  // the same alternates cluster) while llms.txt stays an English index —
  // the same pattern the legal pages use.
  const localizedMarketingRoutes: ArtifactRoute[] = MARKETING_LOCALES.filter(
    (locale) => locale !== 'en',
  ).flatMap((locale) =>
    marketingRoutesForLocale(locale).map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
      alternates: marketingAlternates(r.path),
    })),
  );

  const enLegal: ArtifactRoute[] = legal
    .filter((r) => r.locale === 'en')
    .map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
      alternates: alternatesBySlug.get(r.slug),
    }));

  const otherLegal: ArtifactRoute[] = legal
    .filter((r) => r.locale !== 'en')
    .map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
      alternates: alternatesBySlug.get(r.slug),
    }));

  // Legal pages are noindex — a sitemap lists only indexable URLs, so they
  // are excluded there while staying in llms.txt and the per-page .md set.
  return [
    {
      heading: 'Pages',
      intro: WEB_LLMS_PAGES_INTRO,
      routes: marketingRoutes,
    },
    {
      heading: 'Pages (localised variants)',
      hideFromIndex: true,
      routes: localizedMarketingRoutes,
    },
    { heading: 'Legal', excludeFromSitemap: true, routes: enLegal },
    {
      heading: 'Legal (localised variants)',
      hideFromIndex: true,
      excludeFromSitemap: true,
      routes: otherLegal,
    },
  ];
}

/** Site-relative paths for every legal page — fed to `robots.disallow`. */
export function legalDisallowPaths(legal: readonly LegalRoute[]): string[] {
  return legal.map((route) => route.url);
}

export function webOptionalPages(): OptionalPage[] {
  return [
    { title: 'Documentation', url: TALE_DOCS_LLMS_TXT },
    { title: 'GitHub', url: TALE_GITHUB_URL },
    {
      title: 'Current releases (JSON; includes source and fetch time)',
      url: `${TALE_SITE_URL}${CHANGELOG_JSON_ROUTE}`,
    },
  ];
}

/**
 * Build a `loadBody` for the marketing site. Marketing routes go through
 * the SSR renderer + `htmlToMarkdown`; legal routes read directly from
 * disk. The SSR renderer is passed in so dev (Vite's `ssrLoadModule`)
 * and prod (`import('dist-ssr/entry-server.js')`) plug in different
 * implementations.
 */
export function makeWebLoadBody(
  ssr: SsrRenderer,
): (url: string) => Promise<string | null> {
  // Artifact compilation requests bodies concurrently, but this site's SSR
  // renderer owns one i18n instance. Keep locale changes and React rendering
  // together; a rejected render must not poison the following request.
  let renderQueue: Promise<void> = Promise.resolve();
  return async (url) => {
    if (
      MARKETING_LOCALES.some((locale) =>
        marketingRoutesForLocale(locale).some((route) => route.url === url),
      )
    ) {
      const rendering = renderQueue.then(() => ssr.render(url));
      renderQueue = rendering.then(
        () => undefined,
        () => undefined,
      );
      const { html } = await rendering;
      return htmlToMarkdown(html);
    }
    const legal = await enumerateLegalRoutes();
    const match = legal.find((r) => r.url === url);
    if (match) return legalBody(match);
    return null;
  };
}
