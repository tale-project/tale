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

import type { ArtifactRoute, ArtifactSection, OptionalPage } from '@tale/seo';
import { htmlToMarkdown } from '@tale/seo';
import {
  TALE_DOCS_LLMS_TXT,
  TALE_GITHUB_URL,
  TALE_SITE_URL,
} from '@tale/seo/globals';

import {
  enumerateLegalRoutes,
  LEGAL_CONTENT_ROOT,
  type LegalRoute,
} from '../../scripts/legal-routes';
import { MARKETING_ROUTES } from './marketing-routes';

export const WEB_SITE_TITLE = 'Tale';
export const WEB_SITE_DESCRIPTION =
  'Tale — the sovereign AI platform for data-sensitive organisations. Self-hosted, on your own infrastructure.';

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

export function webOptionalPages(): OptionalPage[] {
  return [
    { title: 'Documentation', url: TALE_DOCS_LLMS_TXT },
    { title: 'GitHub', url: TALE_GITHUB_URL },
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
  return async (url) => {
    if (MARKETING_ROUTES.some((r) => r.url === url)) {
      const { html } = await ssr.render(url);
      return htmlToMarkdown(html);
    }
    const legal = await enumerateLegalRoutes();
    const match = legal.find((r) => r.url === url);
    if (match) return legalBody(match);
    return null;
  };
}
