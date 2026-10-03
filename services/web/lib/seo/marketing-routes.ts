import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { publishedMarketingContent } from '../content/server';
import { localizedPath, type SupportedLocale } from '../i18n/locales';

interface MarketingRoute {
  /** Site-relative URL, e.g. `/`, `/pricing`. */
  url: string;
  /** English canonical path used by the alternate cluster. */
  path: string;
  title: string;
  description: string;
}

interface MarketingSeoEntry {
  title: string;
  description: string;
}

/**
 * Marketing routes the on-demand artifact server is allowed to serve.
 * Used by `lib/seo/artifacts-server.ts` for sitemap/llms.txt entries and by
 * `scripts/prerender.ts` for the static route list. Legal pages live
 * alongside as markdown under `app/content/legal/` and are picked up
 * automatically.
 *
 * Title + description come from the `seo` i18n namespace — the exact strings
 * each page renders via `useT('seo')` + `useDocumentMeta` — so the sitemap,
 * llms.txt, and the prerendered `<head>` all describe a page identically.
 * There is no second copy to drift.
 *
 * The catalog is read with `fs` + the yaml parser rather than imported as a
 * module: every consumer is node-side (prerender, the artifacts server, the
 * SEO tests), and `vite.config.ts` EXECUTES this file's import chain when it
 * loads — a top-level `.yml` import only resolves under the yamlImports
 * plugin, which config-loading tooling (knip) does not run.
 *
 * Keep this list in bijection with `ROUTE_PATHS` in
 * `lib/seo/route-paths.ts` — `marketing-routes.test.ts` guards the pairing.
 */
const ROUTE_SEO_KEYS = [
  { url: '/', key: 'home' },
  { url: '/about', key: 'about' },
  { url: '/pricing', key: 'pricing' },
  { url: '/hardware-pricing', key: 'hardwarePricing' },
  { url: '/contact', key: 'contact' },
  { url: '/request-demo', key: 'requestDemo' },
  { url: '/platform', key: 'platform' },
  { url: '/platform/agents', key: 'platformAgents' },
  { url: '/platform/chat', key: 'platformChat' },
  { url: '/platform/projects', key: 'platformProjects' },
  { url: '/platform/automations', key: 'platformAutomations' },
  { url: '/platform/knowledge', key: 'platformKnowledge' },
  { url: '/platform/governance', key: 'platformGovernance' },
  { url: '/changelog', key: 'changelog' },
] as const;

type RouteSeoKey = (typeof ROUTE_SEO_KEYS)[number]['key'];

/** The `seo` namespace of the English catalog, shape-checked at load: a
 * missing or malformed entry throws HERE (build/prerender time), never as an
 * undefined title in a shipped sitemap. */
function loadSeoNamespace(
  locale: SupportedLocale,
): Record<RouteSeoKey, MarketingSeoEntry> {
  const catalogPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'messages',
    `${locale}.yml`,
  );
  const catalog: unknown = parse(readFileSync(catalogPath, 'utf8'));
  const seo =
    catalog !== null && typeof catalog === 'object' && 'seo' in catalog
      ? catalog.seo
      : undefined;
  if (seo === null || typeof seo !== 'object') {
    throw new Error(
      `messages/${locale}.yml has no "seo" namespace (${catalogPath})`,
    );
  }
  const entries = {} as Record<RouteSeoKey, MarketingSeoEntry>;
  for (const { key } of ROUTE_SEO_KEYS) {
    const entry: unknown = (seo as Record<string, unknown>)[key];
    const title =
      entry !== null && typeof entry === 'object' && 'title' in entry
        ? entry.title
        : undefined;
    const description =
      entry !== null && typeof entry === 'object' && 'description' in entry
        ? entry.description
        : undefined;
    if (typeof title !== 'string' || typeof description !== 'string') {
      throw new Error(
        `messages/${locale}.yml seo.${key} needs title + description`,
      );
    }
    entries[key] = { title, description };
  }
  return entries;
}

/** Static catalog pages and published Markdown pages share one discovery API.
 * The file-backed registry validates publication across all three locales. */
export function marketingRoutesForLocale(
  locale: SupportedLocale,
): MarketingRoute[] {
  const seo = loadSeoNamespace(locale);
  return [
    ...ROUTE_SEO_KEYS.map(({ url, key }) => ({
      url: localizedPath(locale, url),
      path: url,
      title: seo[key].title,
      description: seo[key].description,
    })),
    ...publishedMarketingContent()
      .filter((page) => page.locale === locale)
      .map((page) => ({
        url: page.url,
        path: page.path,
        title: page.frontmatter.title,
        description: page.frontmatter.description,
      })),
  ];
}

const MARKETING_ROUTES: readonly MarketingRoute[] =
  marketingRoutesForLocale('en');

/** English route discovery; includes published content, never draft routes. */
export const MARKETING_ROUTE_URLS = MARKETING_ROUTES.map((route) => route.url);
