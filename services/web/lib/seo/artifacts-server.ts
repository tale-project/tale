/**
 * On-demand SEO + LLM artifact server for the marketing site.
 *
 * Routes come from two sources:
 *
 *   - `MARKETING_ROUTES` — React-rendered pages (`/`, `/pricing`, …).
 *     Bodies are produced lazily by rendering the page through the SSR
 *     entry and converting the HTML to markdown.
 *   - `enumerateLegalRoutes()` — markdown files under
 *     `app/content/legal/{en,de,fr}/*.md`. Bodies are the file contents
 *     with frontmatter stripped.
 *
 * The Vite dev plugin and the Bun production server both reuse the same
 * function so behaviour matches across modes.
 */

import { readFile } from 'node:fs/promises';

import {
  createArtifactsServer,
  htmlToMarkdown,
  type ArtifactRoute,
  type ArtifactSection,
  type ArtifactsServer,
} from '@tale/seo';
import {
  TALE_DOCS_LLMS_TXT,
  TALE_DOCS_URL,
  TALE_GITHUB_URL,
  TALE_SITE_URL,
} from '@tale/seo/globals';

import {
  enumerateLegalRoutes,
  LEGAL_CONTENT_ROOT,
  type LegalRoute,
} from '../../scripts/legal-routes';
import { MARKETING_ROUTES } from './marketing-routes';

const SITE_TITLE = 'Tale';
const SITE_DESCRIPTION =
  'Tale — the sovereign AI platform for data-sensitive organisations. Self-hosted, on your own infrastructure.';

interface Renderer {
  render: (url: string) => Promise<{ html: string }>;
}

interface MarketingArtifactsServerParams {
  /**
   * SSR renderer used to fetch the body of a marketing route. Caller
   * supplies the runtime-specific implementation (Vite `ssrLoadModule`
   * in dev, the prebuilt `dist-ssr/entry-server.js` in prod).
   */
  ssr: Renderer;
  /**
   * Disable caching so dev edits show up without a restart. Defaults to
   * `true` for production.
   */
  cache?: boolean;
}

function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  return match ? match[1] : raw;
}

async function legalBody(route: LegalRoute): Promise<string> {
  const path = `${LEGAL_CONTENT_ROOT}/${route.locale}/${route.slug}.md`;
  return stripFrontmatter(await readFile(path, 'utf-8'));
}

function buildSections(legal: LegalRoute[]): ArtifactSection[] {
  // Group legal entries by slug so we can attach hreflang alternates to
  // every locale variant of the same logical page.
  const alternatesBySlug = new Map<string, Record<string, string>>();
  for (const r of legal) {
    const alts = alternatesBySlug.get(r.slug) ?? {};
    alts[r.locale] = `${TALE_SITE_URL}${r.url}`;
    alternatesBySlug.set(r.slug, alts);
  }
  for (const alts of alternatesBySlug.values()) {
    if (alts.en) alts['x-default'] = alts.en;
  }

  const marketingRoutes: ArtifactRoute[] = MARKETING_ROUTES.map((r) => ({
    url: r.url,
    title: r.title,
    description: r.description,
  }));

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

  return [
    { heading: 'Pages', routes: marketingRoutes },
    { heading: 'Legal', routes: enLegal },
    {
      heading: 'Legal (localised variants)',
      hideFromIndex: true,
      routes: otherLegal,
    },
  ];
}

export function createMarketingArtifactsServer(
  params: MarketingArtifactsServerParams,
): ArtifactsServer {
  return createArtifactsServer({
    siteUrl: TALE_SITE_URL,
    siteTitle: SITE_TITLE,
    siteDescription: SITE_DESCRIPTION,
    cache: params.cache,
    loadRoutes: async () => ({
      sections: buildSections(await enumerateLegalRoutes()),
      optionalPages: [
        { title: 'Documentation', url: TALE_DOCS_LLMS_TXT },
        { title: 'GitHub', url: TALE_GITHUB_URL },
      ],
    }),
    loadBody: async (url) => {
      // Marketing route → SSR + HTML-to-markdown.
      if (MARKETING_ROUTES.some((r) => r.url === url)) {
        const { html } = await params.ssr.render(url);
        return htmlToMarkdown(html);
      }
      // Legal route → file read.
      const legal = await enumerateLegalRoutes();
      const match = legal.find((r) => r.url === url);
      if (match) return legalBody(match);
      return null;
    },
    robots: {
      // Crawlers find the docs surface through its own sitemap too.
      extraSitemaps: [`${TALE_DOCS_URL}/sitemap.xml`],
    },
  });
}
